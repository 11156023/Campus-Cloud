"""Gateway VM 管理服務

負責：
- SSH keypair 生成（ED25519）
- SSH 連線測試
- 遠端讀寫設定檔
- 遠端控制 systemd 服務（start/stop/restart/reload/status）
"""

import io
import logging

import paramiko
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import (
    Encoding,
    NoEncryption,
    PrivateFormat,
)

from app.exceptions import BadRequestError, ProxmoxError

logger = logging.getLogger(__name__)

# Gateway VM 上各服務的設定檔路徑
SERVICE_CONFIG_PATHS: dict[str, str] = {
    "haproxy": "/etc/haproxy/haproxy.cfg",
    "traefik": "/etc/traefik/traefik.yml",
    "frps": "/etc/frp/frps.toml",
    "frpc": "/etc/frp/frpc.toml",
}

# traefik 另外有 dynamic config 目錄（單一檔案）
TRAEFIK_DYNAMIC_PATH = "/etc/traefik/dynamic/campus-cloud.yml"


# ─── SSH keypair 生成 ─────────────────────────────────────────────────────────


def generate_ed25519_keypair() -> tuple[str, str]:
    """生成 ED25519 SSH keypair。
    回傳 (private_key_pem, public_key_openssh)
    """
    priv = Ed25519PrivateKey.generate()
    private_key_pem = priv.private_bytes(
        Encoding.PEM, PrivateFormat.OpenSSH, NoEncryption()
    ).decode()

    # 透過 paramiko 取得 OpenSSH 公鑰格式
    pkey = paramiko.Ed25519Key.from_private_key(io.StringIO(private_key_pem))
    public_key = f"ssh-ed25519 {pkey.get_base64()} campus-cloud-gateway"

    return private_key_pem, public_key


# ─── SSH 連線工具 ─────────────────────────────────────────────────────────────


def _make_client(
    host: str,
    ssh_port: int,
    ssh_user: str,
    private_key_pem: str,
) -> paramiko.SSHClient:
    """建立 SSH 連線，回傳已連線的 SSHClient。"""
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    pkey = paramiko.Ed25519Key.from_private_key(io.StringIO(private_key_pem))
    client.connect(
        hostname=host,
        port=ssh_port,
        username=ssh_user,
        pkey=pkey,
        timeout=10,
        allow_agent=False,
        look_for_keys=False,
    )
    return client


def _exec(client: paramiko.SSHClient, command: str) -> tuple[int, str, str]:
    """執行指令，回傳 (exit_code, stdout, stderr)。"""
    _, stdout, stderr = client.exec_command(command)
    exit_code = stdout.channel.recv_exit_status()
    return exit_code, stdout.read().decode(), stderr.read().decode()


def _get_config(session: object) -> object:
    """從 DB 取得 GatewayConfig，若未設定則 raise。"""
    from sqlmodel import Session  # noqa: PLC0415

    from app.repositories import gateway_config as gw_repo  # noqa: PLC0415

    config = gw_repo.get_gateway_config(session)  # type: ignore[arg-type]
    if config is None or not config.host or not config.encrypted_private_key:
        raise BadRequestError("Gateway VM 尚未設定，請先設定 IP 並生成 SSH 金鑰")
    return config


# ─── 公開操作 ─────────────────────────────────────────────────────────────────


def test_connection(
    host: str,
    ssh_port: int,
    ssh_user: str,
    private_key_pem: str,
) -> tuple[bool, str]:
    """測試 SSH 連線，回傳 (success, message)。"""
    try:
        client = _make_client(host, ssh_port, ssh_user, private_key_pem)
        _, out, _ = _exec(client, "echo ok")
        client.close()
        if out.strip() == "ok":
            return True, "連線成功"
        return False, f"指令回應異常：{out}"
    except paramiko.AuthenticationException:
        return False, "SSH 認證失敗，請確認公鑰已加入 Gateway VM 的 authorized_keys"
    except Exception as e:
        return False, f"連線失敗：{e}"


def read_service_config(session: object, service: str) -> str:
    """讀取 Gateway VM 上指定服務的設定檔內容。"""
    from app.repositories.gateway_config import get_decrypted_private_key  # noqa: PLC0415

    config = _get_config(session)
    private_key_pem = get_decrypted_private_key(config)  # type: ignore[arg-type]

    path = SERVICE_CONFIG_PATHS.get(service)
    if path is None:
        raise BadRequestError(f"未知服務：{service}")

    client = _make_client(config.host, config.ssh_port, config.ssh_user, private_key_pem)
    try:
        sftp = client.open_sftp()
        try:
            with sftp.open(path, "r") as f:
                content = f.read().decode()
        finally:
            sftp.close()
        return content
    except FileNotFoundError:
        return ""
    except Exception as e:
        raise ProxmoxError(f"讀取 {service} 設定失敗：{e}")
    finally:
        client.close()


def write_service_config(session: object, service: str, content: str) -> None:
    """寫入設定檔到 Gateway VM（原子性寫入，先寫暫存檔再 mv）。"""
    from app.repositories.gateway_config import get_decrypted_private_key  # noqa: PLC0415

    config = _get_config(session)
    private_key_pem = get_decrypted_private_key(config)  # type: ignore[arg-type]

    path = SERVICE_CONFIG_PATHS.get(service)
    if path is None:
        raise BadRequestError(f"未知服務：{service}")

    client = _make_client(config.host, config.ssh_port, config.ssh_user, private_key_pem)
    try:
        sftp = client.open_sftp()
        try:
            tmp_path = path + ".tmp"
            with sftp.open(tmp_path, "w") as f:
                f.write(content.encode())
        finally:
            sftp.close()
        # 原子性替換
        code, _, err = _exec(client, f"mv {tmp_path} {path}")
        if code != 0:
            raise ProxmoxError(f"寫入 {service} 設定失敗：{err}")
    except ProxmoxError:
        raise
    except Exception as e:
        raise ProxmoxError(f"寫入 {service} 設定失敗：{e}")
    finally:
        client.close()


def control_service(
    session: object,
    service: str,
    action: str,
) -> tuple[bool, str]:
    """控制 systemd 服務，回傳 (success, output)。
    action: start | stop | restart | reload
    """
    from app.repositories.gateway_config import get_decrypted_private_key  # noqa: PLC0415

    config = _get_config(session)
    private_key_pem = get_decrypted_private_key(config)  # type: ignore[arg-type]

    valid_actions = {"start", "stop", "restart", "reload"}
    if action not in valid_actions:
        raise BadRequestError(f"無效操作：{action}")

    valid_services = set(SERVICE_CONFIG_PATHS.keys())
    if service not in valid_services:
        raise BadRequestError(f"未知服務：{service}")

    try:
        client = _make_client(config.host, config.ssh_port, config.ssh_user, private_key_pem)
        code, out, err = _exec(
            client, f"systemctl {action} {service} 2>&1"
        )
        client.close()
        output = (out + err).strip()
        return code == 0, output or f"{service} {action} 完成"
    except Exception as e:
        return False, str(e)


def get_service_status(session: object, service: str) -> tuple[bool, str]:
    """取得服務狀態，回傳 (is_active, status_text)。"""
    from app.repositories.gateway_config import get_decrypted_private_key  # noqa: PLC0415

    config = _get_config(session)
    private_key_pem = get_decrypted_private_key(config)  # type: ignore[arg-type]

    valid_services = set(SERVICE_CONFIG_PATHS.keys())
    if service not in valid_services:
        raise BadRequestError(f"未知服務：{service}")

    try:
        client = _make_client(config.host, config.ssh_port, config.ssh_user, private_key_pem)
        # is-active 回傳 0 = active
        code, _, _ = _exec(client, f"systemctl is-active {service}")
        # 取得簡短狀態文字
        _, status_out, _ = _exec(
            client,
            f"systemctl show {service} --no-page "
            f"-p ActiveState,SubState,MainPID 2>&1 | head -5",
        )
        client.close()
        return code == 0, status_out.strip()
    except Exception as e:
        return False, str(e)

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "./QuotasPage.module.scss";
import MIcon from "../../../components/MIcon";
import { QuotasService } from "../../../services/quotas";
import { UsersService } from "../../../services/users";
import { useToast } from "../../../hooks/useToast";

const NUMBER_FIELDS = [
  { key: "max_cpu_cores", label: "CPU cores", min: 1, max: 256 },
  { key: "max_memory_mb", label: "記憶體 (MB)", min: 256, max: 1048576 },
  { key: "max_disk_gb", label: "磁碟 (GB)", min: 1, max: 65536 },
  { key: "max_instances", label: "實例數", min: 1, max: 100 },
];

const PICKER_MAX_ROWS = 50;

/** 只取出與基準值不同的欄位，配合後端 partial 更新。 */
function changedFields(form, baseline) {
  return NUMBER_FIELDS.reduce((acc, { key }) => {
    if (Number(form[key]) !== Number(baseline[key])) acc[key] = Number(form[key]);
    return acc;
  }, {});
}

function pickNumbers(source) {
  return NUMBER_FIELDS.reduce((acc, { key }) => {
    acc[key] = Number(source?.[key] ?? 0);
    return acc;
  }, {});
}

function formatUser(user) {
  return user?.full_name ? `${user.full_name}（${user.email}）` : (user?.email ?? "");
}

/* ── 可搜尋的使用者選擇欄位 ───────────────────────────────────────────── */
function UserPicker({ users, loading, value, onChange }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  const selected = users.find((u) => u.id === value) ?? null;

  useEffect(() => {
    const onClickOutside = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const hit = q
      ? users.filter(
          (u) =>
            (u.email ?? "").toLowerCase().includes(q) ||
            (u.full_name ?? "").toLowerCase().includes(q),
        )
      : users;
    return hit.slice(0, PICKER_MAX_ROWS);
  }, [users, query]);

  const handlePick = (user) => {
    onChange(user.id);
    setQuery("");
    setOpen(false);
  };

  return (
    <div className={styles.field} ref={wrapRef}>
      <label htmlFor="quota-user">使用者</label>
      <div className={styles.picker}>
        <input
          id="quota-user"
          autoComplete="off"
          value={query || (selected ? formatUser(selected) : "")}
          placeholder={loading ? "載入使用者中…" : "輸入姓名或 email 搜尋"}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            if (value) onChange("");
          }}
        />
        {open && (
          <ul className={styles.pickerList}>
            {matches.length === 0 ? (
              <li className={styles.pickerEmpty}>
                {loading ? "載入中…" : "查無符合的使用者"}
              </li>
            ) : (
              matches.map((user) => (
                <li key={user.id}>
                  <button
                    type="button"
                    className={styles.pickerItem}
                    onClick={() => handlePick(user)}
                  >
                    <span className={styles.pickerPrimary}>{user.email}</span>
                    {user.full_name && (
                      <span className={styles.pickerSecondary}>{user.full_name}</span>
                    )}
                  </button>
                </li>
              ))
            )}
          </ul>
        )}
      </div>
    </div>
  );
}

/* ── 新增／編輯個人覆寫 ───────────────────────────────────────────────── */
function QuotaDialog({ mode, quota, candidates, loadingUsers, defaults, onClose, onSaved }) {
  const toast = useToast();
  const isEdit = mode === "edit";
  const baseline = useMemo(
    () => pickNumbers(isEdit ? quota : defaults),
    [isEdit, quota, defaults],
  );
  const [userId, setUserId] = useState("");
  const [form, setForm] = useState(baseline);
  const [saving, setSaving] = useState(false);

  const setField = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  const handleSave = async () => {
    setSaving(true);
    try {
      if (isEdit) {
        const patch = changedFields(form, baseline);
        if (Object.keys(patch).length === 0) {
          onClose();
          return;
        }
        await QuotasService.update(quota.id, patch);
        toast.success("配額已更新");
      } else {
        await QuotasService.create({ scope: "user", user_id: userId, ...pickNumbers(form) });
        toast.success("配額已建立");
      }
      onSaved();
    } catch (e) {
      toast.error(e?.message ?? (isEdit ? "更新失敗" : "建立失敗"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <span className={styles.modalTitle}>
          <MIcon name="data_usage" size={18} />
          {isEdit ? "編輯配額" : "新增配額"}
        </span>

        {isEdit ? (
          <div className={styles.field}>
            <label htmlFor="quota-target">使用者</label>
            <input id="quota-target" value={quota.user_email ?? quota.user_id} disabled />
          </div>
        ) : (
          <UserPicker
            users={candidates}
            loading={loadingUsers}
            value={userId}
            onChange={setUserId}
          />
        )}

        <div className={styles.formGrid}>
          {NUMBER_FIELDS.map(({ key, label, min, max }) => (
            <div key={key} className={styles.field}>
              <label htmlFor={`quota-${key}`}>{label}</label>
              <input
                id={`quota-${key}`}
                type="number"
                min={min}
                max={max}
                value={form[key]}
                onChange={(e) => setField(key, Number(e.target.value))}
              />
            </div>
          ))}
        </div>

        {!isEdit && (
          <p className={styles.hint}>
            欄位已帶入目前的全域預設值，改成這位使用者專屬的上限即可。
          </p>
        )}

        <div className={styles.modalActions}>
          <button type="button" className={styles.btnGhost} onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className={styles.btnPrimary}
            disabled={saving || (!isEdit && !userId)}
            onClick={handleSave}
          >
            {saving ? "儲存中…" : isEdit ? "儲存" : "建立"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── 全域預設配額卡片 ─────────────────────────────────────────────────── */
function GlobalQuotaCard({ config, onSaved }) {
  const toast = useToast();
  const baseline = useMemo(() => pickNumbers(config), [config]);
  const [form, setForm] = useState(baseline);
  const [saving, setSaving] = useState(false);

  useEffect(() => setForm(baseline), [baseline]);

  const patch = changedFields(form, baseline);
  const dirty = Object.keys(patch).length > 0;

  const handleSave = async () => {
    setSaving(true);
    try {
      onSaved(await QuotasService.updateGlobal(patch));
      toast.success("全域預設配額已更新");
    } catch (e) {
      toast.error(e?.message ?? "更新失敗");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className={styles.card}>
      <header className={styles.cardHeader}>
        <div className={styles.cardHeading}>
          <span className={styles.cardTitle}>
            <MIcon name="tune" size={18} />
            全域預設配額
          </span>
          <p className={styles.cardSubtitle}>
            沒有個人覆寫的使用者一律套用這組上限。調整只影響之後的新增與擴容，
            不會回頭處理既有資源。
          </p>
        </div>
        {config?.updated_at && (
          <span className={styles.updatedAt}>
            上次更新 {new Date(config.updated_at).toLocaleString("zh-TW")}
          </span>
        )}
      </header>

      <div className={styles.cardBody}>
        <div className={styles.formGrid}>
          {NUMBER_FIELDS.map(({ key, label, min, max }) => (
            <div key={key} className={styles.field}>
              <label htmlFor={`global-${key}`}>{label}</label>
              <input
                id={`global-${key}`}
                type="number"
                min={min}
                max={max}
                value={form[key]}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, [key]: Number(e.target.value) }))
                }
              />
            </div>
          ))}
        </div>

        <div className={styles.cardActions}>
          {dirty && (
            <button
              type="button"
              className={styles.btnGhost}
              disabled={saving}
              onClick={() => setForm(baseline)}
            >
              還原
            </button>
          )}
          <button
            type="button"
            className={styles.btnPrimary}
            disabled={!dirty || saving}
            onClick={handleSave}
          >
            {saving ? "儲存中…" : "儲存"}
          </button>
        </div>
      </div>
    </section>
  );
}

export default function QuotasPage() {
  const toast = useToast();
  const [quotas, setQuotas] = useState(null);
  const [globalQuota, setGlobalQuota] = useState(null);
  const [users, setUsers] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [dialog, setDialog] = useState(null);
  const [deleting, setDeleting] = useState(null);

  const load = useCallback(async () => {
    try {
      const [list, config] = await Promise.all([
        QuotasService.list(),
        QuotasService.getGlobal(),
      ]);
      setQuotas(list);
      setGlobalQuota(config);
    } catch (e) {
      toast.error(e?.message ?? "載入配額失敗");
      setQuotas((prev) => prev ?? []);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    UsersService.listAll()
      .then((list) => {
        if (!cancelled) setUsers(list);
      })
      .catch(() => {
        if (!cancelled) setUsers([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingUsers(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const candidates = useMemo(() => {
    const taken = new Set((quotas ?? []).map((q) => q.user_id));
    return users.filter((u) => !taken.has(u.id));
  }, [users, quotas]);

  const handleDelete = async (quota) => {
    const target = quota.user_email ?? quota.id;
    if (!window.confirm(`確定要刪除「${target}」的配額？刪除後將套用全域預設。`)) return;
    setDeleting(quota.id);
    try {
      await QuotasService.remove(quota.id);
      toast.success("已刪除");
      load();
    } catch (e) {
      toast.error(e?.message ?? "刪除失敗");
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <div className={styles.pageHeading}>
          <h1 className={styles.pageTitle}>配額管理</h1>
          <p className={styles.pageSubtitle}>全域預設值與個別使用者的資源上限覆寫</p>
        </div>
        <button
          type="button"
          className={styles.btnPrimary}
          onClick={() => setDialog({ mode: "create" })}
        >
          <MIcon name="add" size={16} />
          新增配額
        </button>
      </div>

      {globalQuota && <GlobalQuotaCard config={globalQuota} onSaved={setGlobalQuota} />}

      <div className={styles.card}>
        {quotas === null ? (
          <p className={styles.stateText}>載入中…</p>
        ) : quotas.length === 0 ? (
          <div className={styles.empty}>
            <MIcon name="data_usage" size={32} />
            <p>
              尚未設定任何個人覆寫，所有使用者都套用上方的全域預設值
              {globalQuota &&
                `（${globalQuota.max_cpu_cores} cores / ${globalQuota.max_memory_mb} MB / ${globalQuota.max_disk_gb} GB / ${globalQuota.max_instances} 台）`}
              。
            </p>
          </div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>範圍</th>
                <th>對象</th>
                <th>CPU</th>
                <th>記憶體 (MB)</th>
                <th>磁碟 (GB)</th>
                <th>台數</th>
                <th className={styles.thRight}>操作</th>
              </tr>
            </thead>
            <tbody>
              {quotas.map((q) => (
                <tr key={q.id}>
                  <td>
                    <span className={`${styles.badge} ${styles.badge_user}`}>個人覆寫</span>
                  </td>
                  <td>{q.user_email ?? "—"}</td>
                  <td>{q.max_cpu_cores}</td>
                  <td>{q.max_memory_mb}</td>
                  <td>{q.max_disk_gb}</td>
                  <td>{q.max_instances}</td>
                  <td className={styles.tdRight}>
                    <div className={styles.rowActions}>
                      <button
                        type="button"
                        className={styles.btnIcon}
                        onClick={() => setDialog({ mode: "edit", quota: q })}
                        title="編輯配額"
                      >
                        <MIcon name="edit" size={16} />
                      </button>
                      <button
                        type="button"
                        className={styles.btnDanger}
                        disabled={deleting === q.id}
                        onClick={() => handleDelete(q)}
                        title="刪除配額"
                      >
                        <MIcon name="delete" size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {dialog && (
        <QuotaDialog
          mode={dialog.mode}
          quota={dialog.quota}
          candidates={candidates}
          loadingUsers={loadingUsers}
          defaults={globalQuota}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null);
            load();
          }}
        />
      )}
    </div>
  );
}

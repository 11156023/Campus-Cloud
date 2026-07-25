# LiteLLM deployment

This is the standalone LiteLLM Compose project. The deployment list is always
generated from `../models.json`, so alias, served model name, vLLM port and RPM
cannot drift between the launcher and LiteLLM. It is deliberately not included
by the root Campus `docker-compose.yml`.

## Directory layout

```text
vllm-service/litellm/
├── docker-compose.yml       # standalone LiteLLM container
├── config.template.yaml     # tracked static routing policy
├── config.yaml              # generated runtime configuration (ignored)
├── .env.example             # deployment-only environment template
└── .env                     # deployment secrets (ignored)
```

The root Campus `.env` contains only the backend-to-gateway connection values
(`AI_API_*` and `LITELLM_RUNTIME_*`), including the restricted service key.
Keep the LiteLLM master key, upstream key, database URL, and salt key exclusively
in this directory's `.env`; the service key must never be a LiteLLM container
environment variable.

## Start the independent gateway

Run the vLLM cluster first, then generate the configuration and start this
Compose project:

```bash
cd vllm-service
./start_multi_model_cluster.sh
LITELLM_SERVICE_API_KEY=<campus-service-key-from-secret-manager> \
  ./.venv/bin/python tools/generate_litellm_config.py --mode production

cd litellm
cp .env.example .env
# Set the real secrets and DATABASE_URL in .env before continuing.
docker compose up -d
```

Use `docker compose ps`, `docker compose logs -f litellm`, and
`docker compose down` from this directory to manage only LiteLLM. Normal Campus
operations remain `docker compose up -d` at the repository root.

## Phase 4 production database and service identity

After Phase 3 contracts have passed, provision an isolated `litellm` database
and role with the existing PostgreSQL administrator credentials from the root
`.env`. Never run Campus Alembic against that database and never grant the
LiteLLM role write access to Campus schemas or tables.

```bash
# Generate the production config after injecting the service-key environment
# variable. The generated config must contain only environment references.
cd vllm-service
LITELLM_SERVICE_API_KEY=<campus-service-key-from-secret-manager> \
  ./.venv/bin/python tools/generate_litellm_config.py --mode production
cd litellm
docker compose up -d
```

`LITELLM_SALT_KEY` is immutable for the lifetime of the LiteLLM database: back
it up with the database and test restoring both together. The Campus service
Virtual Key is written to the ignored root `.env` and becomes `AI_API_API_KEY`
only during the Phase 5 Campus cutover. The host-network listener on `:4000`
must remain restricted by the host firewall to the Campus backend, monitoring
and admin sources. Do not publish `8103` or `8104`.

For a host using UFW, add the explicit allow rules for the real private source
CIDRs first, then deny all other sources. Replace the placeholders; do not use
`0.0.0.0/0`.

```bash
sudo ufw allow from <campus-backend-private-cidr> to any port 4000 proto tcp
sudo ufw allow from <monitoring-private-cidr> to any port 4000 proto tcp
sudo ufw allow from <admin-vpn-cidr> to any port 4000 proto tcp
sudo ufw deny 4000/tcp
```

Use equivalent ordered rules when the host uses nftables, firewalld, or a
cloud security group. This is intentionally an operator step: the repository
cannot infer the permitted private CIDRs safely.

## Staging checks

Use the isolated staging key, never a `ccai_*` credential:

```bash
curl -fsS http://127.0.0.1:4000/health/liveliness
curl -fsS http://127.0.0.1:4000/health/readiness
curl -fsS -H "Authorization: Bearer $LITELLM_MASTER_KEY" \
  http://127.0.0.1:4000/health
curl -fsS -H "Authorization: Bearer $LITELLM_MASTER_KEY" \
  http://127.0.0.1:4000/v1/models
```

`/health` invokes upstream checks, so use it for a deliberate smoke test, not
as a high-frequency container probe. The Compose health check only calls
`/health/liveliness`.

After exporting the isolated `LITELLM_MASTER_KEY`, use the repeatable full
check below. It proves both deployments are healthy, the `/v1/models` allowlist
has not drifted, and the backend container can reach the host gateway.

```bash
./scripts/verify-litellm-staging.sh
```

To prove the separation, run `docker compose config` at the repository root:
there must be no `litellm` service. From this directory, run
`docker compose config` and `docker compose up -d` to manage the gateway. To
stop only the gateway, run `docker compose stop litellm` here.

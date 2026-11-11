#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="${ROOT_DIR}/backend"
FRONTEND_DIR="${ROOT_DIR}/frontend"

# Load GMI_API_KEY silently from backend/.env if not already exported
if [[ -z "${GMI_API_KEY:-}" && -f "${BACKEND_DIR}/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${BACKEND_DIR}/.env"
  set +a
fi

if [[ -z "${GMI_API_KEY:-}" ]]; then
  echo "[ClausePilot] Warning: GMI_API_KEY is not set in environment or backend/.env" >&2
fi

BACKEND_PID=""
FRONTEND_PID=""

cleanup() {
  echo ""
  echo "[ClausePilot] Shutting down services..."
  if [[ -n "${FRONTEND_PID}" ]] && kill -0 "${FRONTEND_PID}" 2>/dev/null; then
    kill "${FRONTEND_PID}" 2>/dev/null || true
  fi
  if [[ -n "${BACKEND_PID}" ]] && kill -0 "${BACKEND_PID}" 2>/dev/null; then
    kill "${BACKEND_PID}" 2>/dev/null || true
  fi
  wait 2>/dev/null || true
}

trap cleanup SIGINT SIGTERM EXIT

echo "[ClausePilot] Starting FastAPI backend on http://localhost:8000 ..."
(
  cd "${BACKEND_DIR}"
  uv run uvicorn app.main:app --host 0.0.0.0 --port 8000
) &
BACKEND_PID=$!

echo "[ClausePilot] Starting Next.js workbench on http://localhost:3000 ..."
(
  cd "${FRONTEND_DIR}"
  NEXT_PUBLIC_API_URL="${NEXT_PUBLIC_API_URL:-http://localhost:8000}" npm run dev -- --port 3000
) &
FRONTEND_PID=$!

echo "[ClausePilot] Ready -> Workbench: http://localhost:3000 | API Docs: http://localhost:8000/docs"
wait "${BACKEND_PID}" "${FRONTEND_PID}"

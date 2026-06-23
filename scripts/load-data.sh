#!/usr/bin/env bash
# Apache Jena Fuseki — 온톨로지 및 샘플 데이터 로드 스크립트 (bash)
# 사용법: bash scripts/load-data.sh
# 전제 조건: docker compose up -d 로 Fuseki 기동 후 실행

set -euo pipefail

FUSEKI_URL="${FUSEKI_URL:-http://localhost:3030}"
DATASET="${DATASET:-art-auction}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-art-auction-2024}"
AUTH="admin:${ADMIN_PASSWORD}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
ONTOLOGY="${PROJECT_ROOT}/ontology/art-auction-ontology.ttl"
SAMPLE_DATA="${PROJECT_ROOT}/ontology/sample-data.ttl"

DATA_URL="${FUSEKI_URL}/${DATASET}/data?default"
SPARQL_URL="${FUSEKI_URL}/${DATASET}/sparql"

echo "=== Fuseki 데이터 로더 ==="
echo "엔드포인트: ${FUSEKI_URL}/${DATASET}"

# ── Fuseki 준비 대기 ──────────────────────────────────────────────────────────
echo ""
echo "[1/3] Fuseki 기동 대기 중..."
max_attempts=30
attempt=0
ready=false

while [ "$attempt" -lt "$max_attempts" ]; do
    attempt=$((attempt + 1))
    # 쉘에서 $ 를 이스케이프해야 /$/ping 이 리터럴로 전달됨
    if curl -sf -u "$AUTH" "${FUSEKI_URL}/\$/ping" > /dev/null 2>&1; then
        ready=true
        break
    fi
    echo "  대기 중... (${attempt}/${max_attempts})"
    sleep 2
done

if [ "$ready" != "true" ]; then
    echo "ERROR: Fuseki 가 $((max_attempts * 2))초 내에 응답하지 않았습니다." >&2
    echo "       docker compose up -d 를 확인하세요." >&2
    exit 1
fi
echo "  Fuseki 준비 완료"

# ── 온톨로지 로드 (PUT — 기존 데이터 교체) ─────────────────────────────────────
echo ""
echo "[2/3] 온톨로지 로드..."
if [ ! -f "$ONTOLOGY" ]; then
    echo "ERROR: 온톨로지 파일을 찾을 수 없습니다: $ONTOLOGY" >&2
    exit 1
fi
echo "  업로드: art-auction-ontology.ttl (PUT)"
curl -sf -u "$AUTH" \
    -H "Content-Type: text/turtle; charset=utf-8" \
    -X PUT \
    --data-binary @"$ONTOLOGY" \
    "$DATA_URL"
echo "  완료"

# ── 샘플 데이터 로드 (POST — 추가) ────────────────────────────────────────────
echo "  업로드: sample-data.ttl (POST)"
if [ ! -f "$SAMPLE_DATA" ]; then
    echo "ERROR: 샘플 데이터 파일을 찾을 수 없습니다: $SAMPLE_DATA" >&2
    exit 1
fi
curl -sf -u "$AUTH" \
    -H "Content-Type: text/turtle; charset=utf-8" \
    -X POST \
    --data-binary @"$SAMPLE_DATA" \
    "$DATA_URL"
echo "  완료"

# ── 트리플 수 검증 ─────────────────────────────────────────────────────────────
echo ""
echo "[3/3] 트리플 수 검증..."
count=$(curl -sf -u "$AUTH" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -H "Accept: application/sparql-results+json" \
    -X POST \
    --data-urlencode "query=SELECT (COUNT(*) AS ?count) WHERE { ?s ?p ?o }" \
    "$SPARQL_URL" \
    | grep -o '"value":"[0-9]*"' | grep -o '[0-9]*' | head -1)

echo ""
echo "=== 로드 완료 ==="
echo "총 트리플 수: ${count}"
echo "SPARQL 엔드포인트: ${FUSEKI_URL}/${DATASET}/sparql"
echo "관리 콘솔:         ${FUSEKI_URL}"

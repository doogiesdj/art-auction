# Apache Jena Fuseki — 온톨로지 및 샘플 데이터 로드 스크립트 (PowerShell)
# 사용법: .\scripts\load-data.ps1
# 전제 조건: docker compose up -d 로 Fuseki 기동 후 실행

param(
    [string]$FusekiUrl    = "http://localhost:3030",
    [string]$Dataset      = "art-auction",
    [string]$AdminPassword = "art-auction-2024"
)

$ErrorActionPreference = "Stop"

$ScriptDir   = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir
$OntologyFile = Join-Path $ProjectRoot "ontology\art-auction-ontology.ttl"
$SampleDataFile = Join-Path $ProjectRoot "ontology\sample-data.ttl"

# $$ 는 PowerShell 에서 리터럴 $ 두 개가 아니라 단일 $ 이므로
# 문자열 연결로 ping URL 을 구성한다
$PingUrl   = $FusekiUrl + '/$' + '/ping'
$DataUrl   = "$FusekiUrl/$Dataset/data?default"
$SparqlUrl = "$FusekiUrl/$Dataset/sparql"

$AuthBytes = [System.Text.Encoding]::UTF8.GetBytes("admin:$AdminPassword")
$AuthB64   = [Convert]::ToBase64String($AuthBytes)
$AuthHeader = "Basic $AuthB64"

Write-Host "=== Fuseki 데이터 로더 ===" -ForegroundColor Cyan
Write-Host "엔드포인트: $FusekiUrl/$Dataset" -ForegroundColor Cyan

# ── Fuseki 준비 대기 ──────────────────────────────────────────────────────────
Write-Host "`n[1/3] Fuseki 기동 대기 중..." -ForegroundColor Yellow
$maxAttempts = 30
$attempt = 0
$ready = $false

while ($attempt -lt $maxAttempts) {
    $attempt++
    try {
        $resp = Invoke-WebRequest -Uri $PingUrl -UseBasicParsing `
            -Headers @{ Authorization = $AuthHeader } `
            -TimeoutSec 3 -ErrorAction SilentlyContinue
        if ($resp.StatusCode -eq 200) {
            $ready = $true
            break
        }
    } catch { }
    Write-Host "  대기 중... ($attempt/$maxAttempts)" -ForegroundColor DarkGray
    Start-Sleep -Seconds 2
}

if (-not $ready) {
    Write-Error "Fuseki 가 $($maxAttempts * 2)초 내에 응답하지 않았습니다. docker compose up -d 를 확인하세요."
    exit 1
}
Write-Host "  Fuseki 준비 완료" -ForegroundColor Green

# ── 파일 업로드 함수 ──────────────────────────────────────────────────────────
function Invoke-FusekiUpload {
    param(
        [string]$FilePath,
        [string]$UploadUrl,
        [string]$Method = "PUT",
        [string]$Label
    )
    Write-Host "  업로드: $Label" -ForegroundColor Gray
    $bytes = [System.IO.File]::ReadAllBytes($FilePath)
    $resp = Invoke-WebRequest -Uri $UploadUrl -Method $Method `
        -Headers @{
            Authorization  = $AuthHeader
            "Content-Type" = "text/turtle; charset=utf-8"
        } `
        -Body $bytes `
        -UseBasicParsing `
        -ErrorAction Stop
    Write-Host "  완료: HTTP $($resp.StatusCode)" -ForegroundColor Green
}

# ── 온톨로지 로드 (PUT — 기존 데이터 교체) ─────────────────────────────────────
Write-Host "`n[2/3] 온톨로지 로드..." -ForegroundColor Yellow
if (-not (Test-Path $OntologyFile)) {
    Write-Error "온톨로지 파일을 찾을 수 없습니다: $OntologyFile"
    exit 1
}
Invoke-FusekiUpload -FilePath $OntologyFile -UploadUrl $DataUrl -Method "PUT" `
    -Label "art-auction-ontology.ttl (PUT)"

# ── 샘플 데이터 로드 (POST — 추가) ────────────────────────────────────────────
Write-Host "`n  샘플 데이터 로드..." -ForegroundColor Yellow
if (-not (Test-Path $SampleDataFile)) {
    Write-Error "샘플 데이터 파일을 찾을 수 없습니다: $SampleDataFile"
    exit 1
}
Invoke-FusekiUpload -FilePath $SampleDataFile -UploadUrl $DataUrl -Method "POST" `
    -Label "sample-data.ttl (POST)"

# ── 트리플 수 검증 ─────────────────────────────────────────────────────────────
Write-Host "`n[3/3] 트리플 수 검증..." -ForegroundColor Yellow
$countQuery = "SELECT (COUNT(*) AS ?count) WHERE { ?s ?p ?o }"
$body = "query=" + [Uri]::EscapeDataString($countQuery)
$resp = Invoke-WebRequest -Uri $SparqlUrl -Method POST `
    -Headers @{
        Authorization  = $AuthHeader
        "Content-Type" = "application/x-www-form-urlencoded"
        Accept         = "application/sparql-results+json"
    } `
    -Body $body `
    -UseBasicParsing `
    -ErrorAction Stop

$json  = $resp.Content | ConvertFrom-Json
$count = $json.results.bindings[0].count.value

Write-Host "`n=== 로드 완료 ===" -ForegroundColor Cyan
Write-Host "총 트리플 수: $count" -ForegroundColor Green
Write-Host "SPARQL 엔드포인트: $FusekiUrl/$Dataset/sparql" -ForegroundColor Cyan
Write-Host "관리 콘솔:         $FusekiUrl" -ForegroundColor Cyan

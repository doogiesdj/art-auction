# 미술품 경매 플랫폼 AI 오케스트레이션

온톨로지와 지식 그래프 기반의 다차원 검색·추론이 가능한 엔터프라이즈급 미술품 경매 AI 하네스.  
색감, 시대, 작가 유파, 낙찰가 등 복잡한 시맨틱 조건을 자연어로 질의하면 GraphRAG가 SPARQL 쿼리로 변환하고 지식 그래프를 탐색한다.

---

## 아키텍처

```
[사용자 자연어 요청]
        ↓
   [Router Agent]          ← 중앙 디스패처
        ├─────────────────────┬─────────────────────┐
        ↓                     ↓                     ↓
[온톨로지 레이어]       [비즈니스 레이어]       [인지 레이어]
GraphRAG                Auction Business      Image Cognition
  → Schema Validator         ↓                     ↓
  → SPARQL Query     auction_data.json     visual_analysis.json
        ↓
sparql_results.json
        └─────────────────────┴─────────────────────┘
                              ↓
                     [통합 응답 생성]
                     final_response.md
```

3개 레이어는 독립적으로 병렬 실행한다.  
단, 복합 요청(이미지 분석 + 유사 작품 검색)에서는 인지 레이어 완료 후 온톨로지 레이어를 시작한다.

---

## 에이전트 구성

| 에이전트 | 레이어 | 역할 | 모델 |
|---------|--------|------|------|
| `router` | 라우팅 | 요청 분석 → 레이어 디스패치 → 결과 통합 | Opus |
| `graphrag` | 온톨로지 | 자연어 → SPARQL 초안 변환, 다단계 시맨틱 추론 | Opus |
| `schema-validator` | 온톨로지 | SPARQL 구문·스키마 검증, Self-Correction 루프 | Opus |
| `sparql-query` | 온톨로지 | 검증된 쿼리 실행, 결과 정규화 | Opus |
| `auction-business` | 비즈니스 | 경매 트랜잭션 (입찰·낙찰·정산·출처 검증) | Opus |
| `image-cognition` | 인지 | 색감·화풍·시대·구도·기법 분석, 특징 벡터 생성 | Opus |

---

## 온톨로지 레이어 파이프라인

온톨로지 레이어 내부는 파이프라인 순서를 반드시 지킨다.

```
Step 1: GraphRAG
  자연어 → 의도 추출(엔티티·필터·집계) → SPARQL 초안 생성
  → Schema Validator에 전달

Step 2: Schema Validator
  구문 검증 (Level 1) → 스키마 정합성 (Level 2) → 의미적 정합성 (Level 3)
  자가 수정 루프 최대 3회
  Level 3 실패 시 Router에 escalated_l3 보고 → Router가 GraphRAG 재생성 요청 (1회 한정)
  → 승인된 쿼리를 SPARQL Query에 전달

Step 3: SPARQL Query
  검증된 쿼리 실행 → 결과 정규화
  → _workspace/01_ontology/sparql_results.json 저장
```

---

## 스킬 구성

| 스킬 | 사용 에이전트 | 설명 |
|------|-------------|------|
| `art-auction-orchestrator` | router | 최상위 오케스트레이터. 레이어 결정·디스패치·통합 |
| `graphrag-inference` | graphrag | NL→SPARQL 변환, 추론 경로 설계 |
| `schema-validator` | schema-validator | 3단계 검증 + Self-Correction |
| `sparql-query` | sparql-query | 쿼리 실행, 페이지네이션, 타임아웃 관리 |
| `auction-transaction` | auction-business | 경매 상태 머신, 낙관적 잠금, 감사 로그 |
| `image-cognition` | image-cognition | 다차원 이미지 분석, 온톨로지 매핑 |

> 내부 스킬 5개(`graphrag-inference`, `schema-validator`, `sparql-query`, `auction-transaction`, `image-cognition`)는 Router가 에이전트 내부에서 호출하는 전용 스킬이다. 사용자 요청은 `art-auction-orchestrator`를 통해 처리된다.

---

## 온톨로지 PREFIX

```sparql
PREFIX artwork:    <http://art-auction.io/ontology/artwork#>
PREFIX auction:    <http://art-auction.io/ontology/auction#>
PREFIX artist:     <http://art-auction.io/ontology/artist#>
PREFIX period:     <http://art-auction.io/ontology/period#>
PREFIX provenance: <http://art-auction.io/ontology/provenance#>
PREFIX rdf:        <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX rdfs:       <http://www.w3.org/2000/01/rdf-schema#>
PREFIX xsd:        <http://www.w3.org/2001/XMLSchema#>
```

**핵심 엔티티 클래스:**
- `artwork:Artwork` — 작품 (제목, 연도, 매체, 크기)
- `artwork:Artist` — 작가 (이름, 생몰년, 국적, 유파)
- `artwork:ArtMovement` — 미술 사조 (인상주의, 입체파 등)
- `auction:Lot` — 경매 로트 (추정가, 낙찰가, 날짜)
- `artwork:ColorPalette` — 색감 특성 (주조색, 채도, 명도, 온도감)
- `artwork:Period` — 시대 구분

---

## 워크스페이스 구조

실행 중 생성되는 모든 중간 산출물은 `_workspace/`에 저장된다.

```
_workspace/
├── 00_input/
│   └── request.json          # 사용자 원본 요청
├── 01_ontology/
│   ├── graphrag_intent.json  # 의도 추출 결과 + SPARQL 초안
│   ├── validation_log.json   # Schema Validator 수정 내역
│   └── sparql_results.json   # 쿼리 실행 결과
├── 02_business/
│   └── auction_data.json     # 경매 트랜잭션 결과
├── 03_cognition/
│   └── visual_analysis.json  # 이미지 분석 결과
├── final_response.md         # 사용자 최종 응답
└── auction_audit.jsonl       # append-only 감사 로그
```

---

## 사용 예시

### 다차원 검색

```
"1920년대 따뜻한 색조의 인상주의 작품 중 낙찰가 1억 이상인 경매 이력 찾아줘"
```

→ 온톨로지 레이어: GraphRAG가 Period·ColorPalette·ArtMovement·Lot 4개 엔티티를 연결하는 SPARQL 생성 → 검증 → 실행

### 복합 요청 (이미지 + 검색)

```
"이 그림의 화풍을 분석하고 유사한 경매 이력을 검색해줘"
```

→ 인지 레이어(Image Cognition) 먼저 실행 → `ontology_mappings` 추출 → 온톨로지 레이어에 주입하여 SPARQL 생성

### 경매 트랜잭션

```
"Lot #342에 1500만원으로 입찰 등록해줘"
```

→ 비즈니스 레이어: 낙관적 잠금 + 원자적 트랜잭션 처리 → `auction_audit.jsonl` 기록

---

## 핵심 기술

| 개념 | 설명 |
|------|------|
| **GraphRAG** | 자연어 → SPARQL 변환 + 지식 그래프 다단계 추론 |
| **Self-Correction Loop** | Schema Validator가 SPARQL 오류를 자동 탐지·수정 (최대 3회) |
| **Level 3 Escalation** | 의미적 오류는 Router → GraphRAG 재생성 경로로 처리 |
| **Optimistic Locking** | 버전 번호(ETag) 기반 동시 입찰 충돌 방지 |
| **Provenance Chain** | 작품 소유권 체인 검증 — 공백 5년 초과 시 경고 |
| **Hybrid Execution** | 온톨로지 파이프라인 + 비즈니스/인지 레이어 병렬 실행 |
| **Append-Only Audit Log** | 모든 비즈니스 이벤트를 `auction_audit.jsonl`에 불변 기록 |

---

## 디렉토리 구조

```
art-auction/
├── CLAUDE.md                              # 하네스 트리거 규칙 + 변경 이력
├── README.md
└── .claude/
    ├── agents/
    │   ├── router.md
    │   ├── graphrag.md
    │   ├── schema-validator.md
    │   ├── sparql-query.md
    │   ├── auction-business.md
    │   └── image-cognition.md
    └── skills/
        ├── art-auction-orchestrator/
        │   ├── SKILL.md
        │   └── references/
        │       └── query-patterns.md
        ├── graphrag-inference/SKILL.md
        ├── schema-validator/SKILL.md
        ├── sparql-query/SKILL.md
        ├── auction-transaction/SKILL.md
        └── image-cognition/SKILL.md
```

---

## 트리플스토어 설정

### 1. Fuseki 기동

```bash
docker compose up -d
```

관리 콘솔: http://localhost:3030 (admin / art-auction-2024)

### 2. 온톨로지 및 샘플 데이터 로드

**PowerShell (Windows):**
```powershell
.\scripts\load-data.ps1
```

**bash (Linux/macOS):**
```bash
bash scripts/load-data.sh
```

스크립트가 Fuseki 준비를 자동 대기한 후 온톨로지와 샘플 데이터를 순서대로 로드한다.

### 3. 파일 구조

```
ontology/
├── art-auction-ontology.ttl   # OWL 온톨로지 — 클래스·속성 정의
└── sample-data.ttl            # 샘플 인스턴스 — 작가 5명, 작품 12점, 로트 13개
fuseki-config/
└── art-auction.ttl            # Fuseki TDB2 데이터셋 설정
docker-compose.yml             # Apache Jena Fuseki:4
scripts/
├── load-data.ps1              # 데이터 로드 (PowerShell)
└── load-data.sh               # 데이터 로드 (bash)
```

### 4. SPARQL 테스트 쿼리

```sparql
PREFIX artwork: <http://art-auction.io/ontology/artwork#>
PREFIX auction: <http://art-auction.io/ontology/auction#>

SELECT ?title ?year ?hammerPrice
WHERE {
  ?aw  a artwork:Artwork ;
       rdfs:label ?title ;
       artwork:yearCreated ?year ;
       artwork:createdIn    ?period ;
       artwork:belongsToMovement ?mv ;
       artwork:hasColorPalette   ?cp .
  ?period artwork:decade "1920s" .
  ?mv     artwork:name   "인상주의" .
  ?cp     artwork:temperature "warm" .
  ?lot auction:forArtwork ?aw ;
       auction:hammerPrice ?hammerPrice ;
       auction:status      "SETTLED" .
  FILTER(?hammerPrice >= 100000000)
}
```

→ `lot:L2024-INT-003` (모네 수련 1922, 낙찰가 38,500,000,000 KRW) 반환

---

## Claude Code 하네스

이 프로젝트는 [Claude Code](https://claude.ai/code) 하네스로 구성되어 있다. `CLAUDE.md`의 트리거 규칙에 따라 경매 관련 요청이 들어오면 `art-auction-orchestrator` 스킬이 자동으로 활성화되어 Router 에이전트를 통해 적절한 레이어로 디스패치된다.

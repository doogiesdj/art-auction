# 미술품 경매 플랫폼 — 전체 구성 설명서

이 문서는 `art-auction` 프로젝트에서 구축한 모든 것을 설명한다. 무엇을 왜 만들었는지, 각 컴포넌트가 어떻게 연결되는지를 처음 보는 사람도 이해할 수 있도록 기술한다.

---

## 목표

자연어로 미술품을 검색할 수 있는 엔터프라이즈급 경매 AI 플랫폼을 구축한다.

예를 들어 이런 질문을 던지면:

> "1920년대 따뜻한 색조의 인상주의 작품 중 낙찰가 1억 이상인 경매 이력을 찾아줘"

시스템이 자동으로 이것을 SPARQL 쿼리로 변환하고, 지식 그래프를 탐색해서 정확한 결과를 반환한다. 단순 키워드 검색이 아닌 **시맨틱 추론(semantic reasoning)** 기반 검색이다.

---

## 전체 아키텍처

시스템은 **3개 레이어** + **중앙 라우터**로 구성된다.

```
[사용자 자연어 요청]
         ↓
   [Router Agent]          ← 중앙 디스패처. 요청을 분석해 레이어를 결정한다
         │
         ├─────────────────────┬─────────────────────┐
         ↓                     ↓                     ↓
[온톨로지 레이어]        [비즈니스 레이어]       [인지 레이어]
GraphRAG                Auction Business      Image Cognition
  ↓                           ↓                     ↓
Schema Validator        auction_data.json     visual_analysis.json
  ↓
SPARQL Query
  ↓
sparql_results.json
         └─────────────────────┴─────────────────────┘
                               ↓
                      [통합 응답 생성]
                      final_response.md
```

### 레이어 역할

| 레이어 | 담당 영역 | 예시 요청 |
|--------|----------|----------|
| **온톨로지** | 자연어 → SPARQL 변환 → 지식 그래프 탐색 | "인상주의 작품 중 따뜻한 색조 찾아줘" |
| **비즈니스** | 경매 트랜잭션 처리 | "Lot #342 현재 최고가는?", "입찰 등록" |
| **인지** | 이미지 시각 분석 | "이 그림의 화풍과 색감을 분석해줘" |

3개 레이어는 독립적으로 **병렬 실행**된다. 단, 복합 요청(이미지 분석 + 유사 작품 검색)에서는 인지 레이어 결과를 온톨로지 레이어에 주입해야 하므로 순차 실행한다.

---

## 멀티 에이전트 하네스

### Claude Code 하네스(Harness)란

Claude Code의 에이전트 팀 기능을 활용해 복잡한 작업을 분업 처리하는 구조다. 하나의 Claude 인스턴스가 모든 것을 처리하는 대신, 역할별로 특화된 에이전트들이 협업한다.

### 에이전트 구성

| 에이전트 | 파일 | 레이어 | 역할 | 모델 |
|---------|------|--------|------|------|
| `router` | `.claude/agents/router.md` | 라우팅 | 중앙 디스패처. 요청 분석 → 레이어 결정 → 결과 통합 | Opus |
| `graphrag` | `.claude/agents/graphrag.md` | 온톨로지 | 자연어 → SPARQL 초안 변환. 추론 경로 설계 | Opus |
| `schema-validator` | `.claude/agents/schema-validator.md` | 온톨로지 | SPARQL 구문·스키마·의미 3단계 검증. Self-Correction 루프 | Opus |
| `sparql-query` | `.claude/agents/sparql-query.md` | 온톨로지 | 검증된 쿼리를 Fuseki에 실행. 결과 정규화 | Opus |
| `auction-business` | `.claude/agents/auction-business.md` | 비즈니스 | 경매 상태 머신. 입찰·낙찰·정산·출처 검증 | Opus |
| `image-cognition` | `.claude/agents/image-cognition.md` | 인지 | 색감·화풍·시대·구도·기법 분석. 특징 벡터 생성 | Opus |

### 스킬 구성

스킬은 에이전트에게 "어떻게 작업하는가"를 알려주는 행동 지침서다.

| 스킬 | 경로 | 담당 에이전트 | 내용 |
|------|------|-------------|------|
| `art-auction-orchestrator` | `.claude/skills/art-auction-orchestrator/SKILL.md` | router | 전체 워크플로우 조율. Phase 0~3 실행 절차 |
| `graphrag-inference` | `.claude/skills/graphrag-inference/SKILL.md` | graphrag | NL→SPARQL 변환 패턴. 추론 경로 설계 방법론 |
| `schema-validator` | `.claude/skills/schema-validator/SKILL.md` | schema-validator | 3단계 검증 규칙. 자가 수정 절차 |
| `sparql-query` | `.claude/skills/sparql-query/SKILL.md` | sparql-query | Fuseki HTTP API 사용법. 페이지네이션·타임아웃 처리 |
| `auction-transaction` | `.claude/skills/auction-transaction/SKILL.md` | auction-business | 경매 상태 머신 규칙. 낙관적 잠금 방법론 |
| `image-cognition` | `.claude/skills/image-cognition/SKILL.md` | image-cognition | 시각 분석 차원. 온톨로지 매핑 방법 |

### 온톨로지 레이어 파이프라인

온톨로지 레이어 내부는 반드시 이 순서를 지킨다:

```
Step 1: GraphRAG
  자연어 → 의도 추출(엔티티·필터·집계) → SPARQL 초안 생성
  → _workspace/01_ontology/graphrag_intent.json 저장
  → Schema Validator에 전달

Step 2: Schema Validator
  Level 1: 구문 검증 (PREFIX·변수·괄호)
  Level 2: 스키마 정합성 (존재하는 클래스·속성인지 확인)
  Level 3: 의미적 정합성 (도메인·레인지 매칭)
  자가 수정 루프 최대 3회
  Level 3 실패 시 → Router에 escalated_l3 보고 → Router가 GraphRAG 재생성 요청 (1회 한정)
  → 승인된 쿼리를 SPARQL Query에 전달

Step 3: SPARQL Query
  검증된 쿼리 실행 → 결과 정규화
  → _workspace/01_ontology/sparql_results.json 저장
```

### CLAUDE.md 트리거 규칙

`CLAUDE.md`에 등록된 하네스 포인터 덕분에 새 Claude Code 세션을 시작해도 자동으로 하네스가 활성화된다. 미술품 경매 관련 요청(검색, 입찰, 이미지 분석 등)을 입력하면 `art-auction-orchestrator` 스킬이 트리거되어 Router 에이전트를 통해 적절한 레이어로 디스패치된다.

---

## OWL 온톨로지

파일: `ontology/art-auction-ontology.ttl`

지식 그래프의 **스키마(Schema)**다. 미술품 도메인에 어떤 개념이 있고 개념들 사이에 어떤 관계가 있는지를 OWL(Web Ontology Language)로 정의한다.

### 7개 클래스

| 클래스 | URI | 설명 |
|--------|-----|------|
| `artwork:Artwork` | `http://art-auction.io/ontology/artwork#Artwork` | 미술 작품. 회화·조각·판화 등 |
| `artwork:Artist` | `http://art-auction.io/ontology/artwork#Artist` | 작가 |
| `artwork:ArtMovement` | `http://art-auction.io/ontology/artwork#ArtMovement` | 미술 사조 (인상주의, 입체파 등) |
| `artwork:ColorPalette` | `http://art-auction.io/ontology/artwork#ColorPalette` | 색감 특성 (온도감·채도·명도) |
| `artwork:Period` | `http://art-auction.io/ontology/artwork#Period` | 시대 구분 (10년 단위 연대) |
| `auction:Lot` | `http://art-auction.io/ontology/auction#Lot` | 경매 로트. 한 작품이 여러 번 출품 가능 |
| `provenance:ProvenanceRecord` | `http://art-auction.io/ontology/provenance#ProvenanceRecord` | 소유권 이전 이력 레코드 |

### 주요 관계(Object Properties)

```
Artwork ──createdBy──→ Artist
Artwork ──createdIn──→ Period
Artwork ──belongsToMovement──→ ArtMovement
Artwork ──hasColorPalette──→ ColorPalette
Artwork ──hasProvenance──→ ProvenanceRecord
Lot ──forArtwork──→ Artwork
Artist ──memberOf──→ ArtMovement
ProvenanceRecord ──nextRecord──→ ProvenanceRecord  (체인 연결)
```

### 네임스페이스

```sparql
PREFIX artwork:    <http://art-auction.io/ontology/artwork#>
PREFIX auction:    <http://art-auction.io/ontology/auction#>
PREFIX artist:     <http://art-auction.io/ontology/artist#>
PREFIX period:     <http://art-auction.io/ontology/period#>
PREFIX provenance: <http://art-auction.io/ontology/provenance#>
```

---

## 트리플스토어 (Apache Jena Fuseki)

### 트리플스토어란

일반 RDB는 행·열 테이블에 데이터를 저장한다. 트리플스토어는 모든 데이터를 **"주어-술어-목적어(Subject-Predicate-Object)"** 형태의 트리플로 저장한다.

예시:
```
<water-lilies-1922> <createdBy> <monet-claude>
<water-lilies-1922> <createdIn> <1920s>
<water-lilies-1922> <hasColorPalette> <warm-high-high>
```

이 구조 덕분에 "1920년대 → 따뜻한 색조 → 인상주의 → 낙찰가 1억 이상"처럼 여러 엔티티를 가로지르는 복잡한 그래프 탐색이 가능하다.

### 구성

- **엔진**: Apache Jena Fuseki 5.1.0 (Docker 이미지: `stain/jena-fuseki`)
- **백엔드**: TDB2 — Fuseki 전용 고성능 영구 저장소
- **포트**: 3030
- **데이터셋**: `art-auction`
- **접근 엔드포인트**:
  - SPARQL 쿼리: `http://localhost:3030/art-auction/sparql`
  - 데이터 업로드: `http://localhost:3030/art-auction/data`
  - 관리 콘솔: `http://localhost:3030` (admin / art-auction-2024)

### Fuseki 설정 파일

파일: `fuseki-config/art-auction.ttl`

```turtle
<#service_art_auction>
    rdf:type   fuseki:Service ;
    fuseki:name "art-auction" ;
    fuseki:endpoint [ fuseki:operation fuseki:query ;  fuseki:name "sparql" ] ;
    fuseki:endpoint [ fuseki:operation fuseki:update ; fuseki:name "update" ] ;
    fuseki:endpoint [ fuseki:operation fuseki:gsp-rw ; fuseki:name "data"   ] ;
    fuseki:dataset <#tdb2_art_auction> .

<#tdb2_art_auction> rdf:type tdb2:DatasetTDB2 ;
    tdb2:location "/fuseki/databases/art-auction" .
```

4개 엔드포인트를 열어둔다: SPARQL 조회(`sparql`), 업데이트(`update`), 읽기/쓰기(`data`), 읽기 전용(`get`).

### Docker Compose 설정 변경 이력

처음 설정에서 3번의 수정이 있었다.

| 문제 | 원인 | 수정 |
|------|------|------|
| 이미지 없음 | `apache/jena-fuseki:4`는 Docker Hub에 존재하지 않음 | `stain/jena-fuseki`로 변경 |
| `/fuseki/databases` 쓰기 거부 | Docker 볼륨이 root 소유, 컨테이너 유저 쓰기 불가 | `user: "0"` 추가 (root로 실행) |
| `/fuseki/configuration` 쓰기 거부 | `:ro` (읽기 전용) 마운트 — Fuseki가 `shiro.ini` 등을 써야 함 | `:ro` 제거 |

최종 `docker-compose.yml`:

```yaml
services:
  fuseki:
    image: stain/jena-fuseki
    container_name: art-auction-fuseki
    user: "0"
    ports:
      - "3030:3030"
    environment:
      - ADMIN_PASSWORD=art-auction-2024
      - JVM_ARGS=-Xmx2g -Xms512m
    volumes:
      - fuseki-data:/fuseki/databases
      - ./fuseki-config:/fuseki/configuration
    healthcheck:
      test: ["CMD-SHELL", "wget -q -O /dev/null http://localhost:3030/ 2>&1; [ $? -le 1 ] && exit 0 || exit 1"]
      interval: 10s
      timeout: 5s
      retries: 18
      start_period: 40s
    restart: unless-stopped

volumes:
  fuseki-data:
    name: art-auction-fuseki-data
```

---

## 샘플 인스턴스 데이터

파일: `ontology/sample-data.ttl`

온톨로지가 스키마라면 샘플 데이터는 실제 데이터다. 총 **680 트리플**이 로드되어 있다.

### 미술 사조 (4개)

| URI | 이름 | 시대 |
|-----|------|------|
| `mv:impressionism` | 인상주의 | modern |
| `mv:korean-abstract` | 한국 추상표현주의 | modern |
| `mv:korean-realism` | 한국 민족 리얼리즘 | modern |
| `mv:korean-figurative` | 한국 서정적 구상 | modern |

### 시대 (8개)

1880년대 ~ 1980년대 10년 단위로 정의.

### 색감 팔레트 (8개)

온도감(warm/cool/neutral) × 채도(high/medium/low) × 명도(high/medium/low) 조합으로 정의.

| URI | 온도감 | 채도 | 명도 | 주조색 |
|-----|--------|------|------|--------|
| `cp:warm-high-high` | warm | high | high | yellow-green, violet |
| `cp:warm-medium-high` | warm | medium | high | gold, orange |
| `cp:cool-high-medium` | cool | high | medium | blue, indigo |
| `cp:neutral-low-medium` | neutral | low | medium | grey, beige |
| ... | ... | ... | ... | ... |

### 작가 (5명)

| URI | 이름 | 생몰년 | 국적 | 사조 |
|-----|------|--------|------|------|
| `ar:monet-claude` | 클로드 모네 | 1840–1926 | French | 인상주의 |
| `ar:kim-whanki` | 김환기 | 1913–1974 | Korean | 한국 추상표현주의 |
| `ar:park-sookeun` | 박수근 | 1914–1965 | Korean | 한국 민족 리얼리즘 |
| `ar:lee-jungseop` | 이중섭 | 1916–1956 | Korean | 한국 민족 리얼리즘 |
| `ar:chun-kyungja` | 천경자 | 1924–2015 | Korean | 한국 서정적 구상 |

### 작품 (12점)

| URI | 제목 | 작가 | 연도 | 매체 |
|-----|------|------|------|------|
| `aw:water-lilies-1906` | 수련 1906 | 모네 | 1906 | oil on canvas |
| `aw:water-lilies-1922` | 수련 1922 | 모네 | 1922 | oil on canvas |
| `aw:haystacks-1891` | 건초더미 1891 | 모네 | 1891 | oil on canvas |
| `aw:where-did-we-meet-1970` | 어디서 무엇이 되어 다시 만나랴 | 김환기 | 1970 | oil on cotton |
| `aw:universe-1971` | 우주 5-IV-71 #200 | 김환기 | 1971 | oil on cotton |
| `aw:rondo-1938` | 론도 1938 | 김환기 | 1938 | oil on canvas |
| `aw:laundry-women-1954` | 빨래터 1954 | 박수근 | 1954 | oil on hardboard |
| `aw:two-children-1962` | 두 아이 1962 | 박수근 | 1962 | oil on hardboard |
| `aw:bull-1953` | 황소 1953 | 이중섭 | 1953 | oil on board |
| `aw:white-ox-1954` | 흰 소 1954 | 이중섭 | 1954 | oil on board |
| `aw:woman-with-flowers-1974` | 화관의 여인 1974 | 천경자 | 1974 | gouache on paper |
| `aw:peonies-1980` | 목단 1980 | 천경자 | 1980 | gouache on paper |

### 경매 로트 (13개)

12개는 SETTLED(낙찰 완료), 1개는 SCHEDULED(예정). 주요 로트:

| URI | 작품 | 경매 회사 | 낙찰가 |
|-----|------|----------|--------|
| `lot:L2024-INT-003` | 수련 1922 (모네) | Sotheby's Seoul | 385억 KRW |
| `lot:L2023-001-int` | 수련 1906 (모네) | Christie's Seoul | 470억 KRW |
| `lot:L2022-007` | 우주 (김환기) | 서울옥션 | 185억 KRW |
| `lot:L2023-001` | 어디서 무엇이 (김환기) | 케이옥션 | 132억 KRW |
| `lot:L2024-008` | 황소 (이중섭) | 서울옥션 | 32억 KRW |
| `lot:L2026-001` | 어디서 무엇이 (김환기) | 케이옥션 | 예정 (추정 140~180억) |

### 출처 체인 (2개)

소유권 이전 이력을 `ProvenanceRecord` 링크드 리스트로 구성한다.

**김환기 '어디서 무엇이 되어 다시 만나랴' 출처 체인:**
```
prov:where-p1 → prov:where-p2 → prov:where-p3
(김환기 작가, 1970) → (홍라희, 1974) → (리움미술관, 2023)
```

**박수근 '빨래터' 출처 체인:**
```
prov:laundry-p1 → prov:laundry-p2 → prov:laundry-p3
(박수근 작가, 1954) → (개인 소장, 1965) → (컬렉터A, 2023)
```

---

## 데이터 로드 스크립트

Fuseki가 기동된 후 온톨로지와 샘플 데이터를 로드하는 스크립트다.

### PowerShell (Windows)

파일: `scripts/load-data.ps1`

```powershell
.\scripts\load-data.ps1
```

1. Fuseki 준비 대기 (최대 60초, 2초 간격 폴링)
2. 온톨로지 **PUT** — 기존 데이터 교체
3. 샘플 데이터 **POST** — 추가
4. SPARQL COUNT 쿼리로 로드된 트리플 수 검증

> PowerShell에서 `Invoke-WebRequest`의 `.Content` 속성은 바이트 배열을 반환한다. JSON 파싱 전에 `[System.Text.Encoding]::UTF8.GetString()`으로 디코딩해야 한다.

### bash (Linux/macOS)

파일: `scripts/load-data.sh`

```bash
bash scripts/load-data.sh
```

동일한 절차를 curl로 실행한다. `/$/ping` 엔드포인트를 폴링해 Fuseki 준비 여부를 확인한다.

---

## GraphRAG 검증 시나리오

시스템이 실제로 작동하는지 확인하는 핵심 테스트 케이스다.

**입력 (자연어):**
```
"1920년대 따뜻한 색조의 인상주의 작품 중 낙찰가 1억 이상인 경매 이력을 찾아줘"
```

**GraphRAG 추론 경로:**
```
Artwork → createdIn → Period (decade = "1920s")
       → hasColorPalette → ColorPalette (temperature = "warm")
       → belongsToMovement → ArtMovement (name = "인상주의")
Lot → forArtwork → Artwork
    → status = "SETTLED"
    → hammerPrice ≥ 100,000,000
```

**생성된 SPARQL:**
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

**결과:**
```json
{
  "title": "수련 1922",
  "year": 1922,
  "hammerPrice": 38500000000
}
```

→ `lot:L2024-INT-003` (모네 수련 1922, Sotheby's Seoul, 2024-11-07, **385억 KRW**) 정확히 반환.

---

## 워크스페이스 구조

에이전트 실행 중 생성되는 모든 중간 산출물은 `_workspace/`에 저장된다. 사후 검증과 감사 추적에 활용한다.

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

## 전체 파일 구조

```
art-auction/
├── CLAUDE.md                              # 하네스 트리거 규칙 + 변경 이력
├── README.md                              # 사용 가이드
├── Explain.md                             # 이 파일
├── docker-compose.yml                     # Apache Jena Fuseki 컨테이너 설정
├── fuseki-config/
│   └── art-auction.ttl                    # Fuseki TDB2 데이터셋 설정
├── ontology/
│   ├── art-auction-ontology.ttl           # OWL 온톨로지 (7 클래스, 전체 속성 정의)
│   └── sample-data.ttl                    # 샘플 데이터 (작가 5명·작품 12점·로트 13개)
├── scripts/
│   ├── load-data.ps1                      # 데이터 로드 (PowerShell / Windows)
│   └── load-data.sh                       # 데이터 로드 (bash / Linux·macOS)
└── .claude/
    ├── agents/
    │   ├── router.md                      # Router Agent 정의
    │   ├── graphrag.md                    # GraphRAG Agent 정의
    │   ├── schema-validator.md            # Schema Validator Agent 정의
    │   ├── sparql-query.md                # SPARQL Query Agent 정의
    │   ├── auction-business.md            # Auction Business Agent 정의
    │   └── image-cognition.md             # Image Cognition Agent 정의
    └── skills/
        ├── art-auction-orchestrator/
        │   ├── SKILL.md                   # 오케스트레이터 스킬 (전체 워크플로우)
        │   └── references/
        │       └── query-patterns.md      # SPARQL 쿼리 패턴 레퍼런스
        ├── graphrag-inference/SKILL.md    # GraphRAG 추론 스킬
        ├── schema-validator/SKILL.md      # 검증 스킬
        ├── sparql-query/SKILL.md          # 쿼리 실행 스킬
        ├── auction-transaction/SKILL.md   # 경매 트랜잭션 스킬
        └── image-cognition/SKILL.md       # 이미지 분석 스킬
```

---

## 빠른 시작

### 1. Fuseki 기동

```powershell
docker compose up -d
```

컨테이너가 `healthy` 상태가 될 때까지 대기한다 (약 40초).

### 2. 데이터 로드

```powershell
.\scripts\load-data.ps1
```

성공 시 "총 트리플 수: 680" 출력.

### 3. SPARQL 직접 조회

관리 콘솔 `http://localhost:3030` (admin / art-auction-2024) → Dataset: `art-auction` → Query 탭에서 실행.

### 4. AI 하네스 활성화

Claude Code에서 다음과 같이 자연어로 요청하면 `art-auction-orchestrator` 스킬이 자동 트리거된다:

```
1950년대 한국 민족 리얼리즘 작품 중 낙찰가가 가장 높은 경매를 찾아줘
```

---

## 기술 스택 요약

| 컴포넌트 | 기술 | 버전 |
|---------|------|------|
| AI 오케스트레이션 | Claude Code (Opus) | claude-sonnet-4-6 |
| 지식 표현 | OWL 2 / Turtle | — |
| 쿼리 언어 | SPARQL 1.1 | — |
| 트리플스토어 | Apache Jena Fuseki | 5.1.0 |
| 영구 저장소 | TDB2 | — |
| 컨테이너 | Docker / Docker Compose | — |
| 운영 환경 | Windows 11 / PowerShell 7 | — |

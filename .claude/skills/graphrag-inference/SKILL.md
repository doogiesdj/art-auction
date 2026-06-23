---
name: graphrag-inference
description: "[에이전트 전용] Router 에이전트가 내부 호출하는 GraphRAG 시맨틱 추론 스킬. 사용자 직접 요청은 art-auction-orchestrator로 처리한다. 자연어 요청을 SPARQL 초안으로 변환하고 온톨로지 지식 그래프의 다단계 시맨틱 관계를 추론한다. 온톨로지 기반 검색·다차원 분류·작품-작가-경매 관계 추론이 필요한 에이전트가 이 스킬을 사용한다."
---

# GraphRAG Inference Skill

자연어 질의를 구조화된 SPARQL 쿼리로 변환하고 지식 그래프를 통한 다단계 추론을 수행하는 스킬.

## 핵심 작업 흐름

### Step 1: 의도 분해

자연어에서 다음 요소를 추출한다:

```
자연어: "1920년대 인상주의 작가의 따뜻한 색조 작품 중 낙찰가 1억 이상"

추출 결과:
- 엔티티: Artwork, Artist, ArtMovement, Lot
- 속성 필터:
    * Period.decade = 1920s
    * ArtMovement.name = "Impressionism"
    * ColorPalette.temperature = "warm"
    * Lot.hammerPrice >= 100,000,000
- 집계: 없음
- 정렬: 없음 (명시 없으면 생략)
```

### Step 2: 추론 경로 설계

추출된 요소를 온톨로지 관계로 연결하는 경로를 설계한다.

**경로 설계 원칙:**
- 가장 선택성(selectivity)이 높은 조건을 경로 시작점으로 둔다 (필터링 효율 최대화)
- 불필요한 중간 홉(hop)은 제거한다
- OPTIONAL은 사용자가 "있으면 좋겠다"고 명시한 조건에만 적용한다

**경로 예시:**
```
Lot (hammerPrice >= 1억)
  → forArtwork → Artwork
  → hasColorPalette → ColorPalette (temperature = warm)
  → createdIn → Period (decade = 1920s)
  → createdBy → Artist
  → memberOf → ArtMovement (name = Impressionism)
```

### Step 3: SPARQL 초안 생성

```sparql
PREFIX artwork: <http://art-auction.io/ontology/artwork#>
PREFIX auction: <http://art-auction.io/ontology/auction#>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>

SELECT ?artwork ?artworkLabel ?artist ?artistLabel ?hammerPrice
WHERE {
  ?lot auction:forArtwork ?artwork ;
       auction:hammerPrice ?hammerPrice .
  FILTER(?hammerPrice >= "100000000"^^xsd:integer)

  ?artwork artwork:hasColorPalette ?palette ;
           artwork:createdIn ?period ;
           artwork:createdBy ?artist ;
           rdfs:label ?artworkLabel .

  ?palette artwork:temperature "warm" .
  ?period artwork:decade "1920s" .

  ?artist artwork:memberOf ?movement ;
          rdfs:label ?artistLabel .
  ?movement artwork:name "Impressionism" .
}
ORDER BY DESC(?hammerPrice)
```

### Step 4: 초안 전달

생성된 SPARQL 초안을 Schema Validator에게 전달한다:
```json
{
  "sparql_draft": "<위 쿼리>",
  "original_intent": "원래 자연어 요청",
  "ontology_schema": { "classes": [...], "properties": [...] }
}
```

Schema Validator의 승인 없이 직접 실행하지 않는다.

## 복잡도별 처리 전략

| 복잡도 | 판단 기준 | 전략 |
|--------|----------|------|
| Simple | 1~2개 엔티티, 단순 필터 | 단일 SELECT 쿼리 |
| Medium | 3~4개 엔티티, 집계 포함 | 서브쿼리 또는 다중 WHERE 블록 |
| Complex | 5개+ 엔티티, 추론 체인 | 쿼리 2~3개로 분해, 순차 실행 계획 제시 |

복잡도 "complex"이면 분해된 쿼리 실행 계획을 Router에게 먼저 보고하고 승인을 받는다.

## 온톨로지 PREFIX 표준

```sparql
PREFIX artwork:  <http://art-auction.io/ontology/artwork#>
PREFIX auction:  <http://art-auction.io/ontology/auction#>
PREFIX artist:   <http://art-auction.io/ontology/artist#>
PREFIX period:   <http://art-auction.io/ontology/period#>
PREFIX provenance: <http://art-auction.io/ontology/provenance#>
PREFIX rdf:      <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX rdfs:     <http://www.w3.org/2000/01/rdf-schema#>
PREFIX xsd:      <http://www.w3.org/2001/XMLSchema#>
PREFIX owl:      <http://www.w3.org/2002/07/owl#>
```

## 온톨로지 범위 밖 처리

다음 요청 유형은 GraphRAG 범위 밖이다:
- 감정적 해석 ("이 작품이 슬픔을 표현하는가") → Image Cognition으로 위임 제안
- 실시간 입찰 정보 ("현재 최고가는?") → Auction Business로 위임 제안
- 이미지 없이 화풍 판별 ("이 그림 화풍이 뭐야?") → Image Cognition으로 위임 제안

범위 밖 요청은 거부하지 않고, 적절한 레이어로의 라우팅을 Router에게 제안한다.

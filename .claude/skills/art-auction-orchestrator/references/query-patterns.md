# Art Auction Query Patterns

GraphRAG가 참조하는 도메인별 SPARQL 쿼리 패턴 모음.

## 목차

1. [기본 검색 패턴](#1-기본-검색-패턴)
2. [다차원 분류 패턴](#2-다차원-분류-패턴)
3. [집계 및 통계 패턴](#3-집계-및-통계-패턴)
4. [경매 이력 패턴](#4-경매-이력-패턴)
5. [복합 추론 패턴](#5-복합-추론-패턴)

---

## 1. 기본 검색 패턴

### 작가 이름으로 작품 검색
```sparql
PREFIX artwork: <http://art-auction.io/ontology/artwork#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>

SELECT ?artwork ?title ?year WHERE {
  ?artwork a artwork:Artwork ;
           artwork:createdBy ?artist ;
           rdfs:label ?title ;
           artwork:creationYear ?year .
  ?artist rdfs:label ?artistName .
  FILTER(CONTAINS(LCASE(?artistName), LCASE("모네")))
}
ORDER BY ?year
```

### 특정 사조의 작품 조회
```sparql
SELECT ?artwork ?title ?artist WHERE {
  ?artwork a artwork:Artwork ;
           artwork:createdBy ?artistUri ;
           rdfs:label ?title .
  ?artistUri artwork:memberOf ?movement ;
             rdfs:label ?artist .
  ?movement artwork:name "Impressionism" .
}
```

---

## 2. 다차원 분류 패턴

### 색감 + 시대 복합 필터
```sparql
SELECT ?artwork ?title ?decade ?temperature WHERE {
  ?artwork a artwork:Artwork ;
           rdfs:label ?title ;
           artwork:hasColorPalette ?palette ;
           artwork:createdIn ?period .
  ?palette artwork:temperature ?temperature .
  ?period artwork:decade ?decade .
  FILTER(?temperature = "warm")
  FILTER(?decade IN ("1920s", "1930s"))
}
```

### 작가 연령대 기반 검색

작가 창작 당시 나이 계산 패턴:
```sparql
SELECT ?artwork ?title ?artistAge WHERE {
  ?artwork a artwork:Artwork ;
           rdfs:label ?title ;
           artwork:createdBy ?artist ;
           artwork:creationYear ?year .
  ?artist artwork:birthYear ?birthYear .
  BIND((?year - ?birthYear) AS ?artistAge)
  FILTER(?artistAge >= 20 && ?artistAge <= 35)
}
```

---

## 3. 집계 및 통계 패턴

### 사조별 평균 낙찰가
```sparql
SELECT ?movementName (AVG(?price) AS ?avgPrice) (COUNT(?lot) AS ?lotCount) WHERE {
  ?lot auction:forArtwork ?artwork ;
       auction:hammerPrice ?price .
  ?artwork artwork:createdBy ?artist .
  ?artist artwork:memberOf ?movement .
  ?movement artwork:name ?movementName .
}
GROUP BY ?movementName
ORDER BY DESC(?avgPrice)
```

### 색감별 경매 분포
```sparql
SELECT ?temperature (COUNT(?artwork) AS ?count) (AVG(?price) AS ?avgHammerPrice) WHERE {
  ?artwork artwork:hasColorPalette ?palette .
  ?palette artwork:temperature ?temperature .
  OPTIONAL {
    ?lot auction:forArtwork ?artwork ;
         auction:hammerPrice ?price .
  }
}
GROUP BY ?temperature
```

---

## 4. 경매 이력 패턴

### 특정 작품의 경매 이력 전체 조회
```sparql
SELECT ?lot ?auctionDate ?hammerPrice ?buyer WHERE {
  ?lot auction:forArtwork <artwork-uri> ;
       auction:auctionDate ?auctionDate ;
       auction:hammerPrice ?hammerPrice .
  OPTIONAL { ?lot auction:buyer ?buyer . }
}
ORDER BY ?auctionDate
```

### 낙찰가 상위 작품 (특정 시기)
```sparql
SELECT ?artwork ?title ?hammerPrice ?auctionDate WHERE {
  ?lot auction:forArtwork ?artwork ;
       auction:hammerPrice ?hammerPrice ;
       auction:auctionDate ?auctionDate .
  ?artwork rdfs:label ?title .
  FILTER(?auctionDate >= "2020-01-01"^^xsd:date)
}
ORDER BY DESC(?hammerPrice)
LIMIT 20
```

---

## 5. 복합 추론 패턴

### 이미지 분석 결과 기반 유사 작품 검색

Image Cognition 결과(`ontology_mappings`)를 활용하는 패턴:
```sparql
# image-cognition 출력: temperature=cool, movement=Impressionism, decade=1890s
SELECT ?artwork ?title ?artist WHERE {
  ?artwork a artwork:Artwork ;
           rdfs:label ?title ;
           artwork:hasColorPalette ?palette ;
           artwork:createdIn ?period ;
           artwork:createdBy ?artistUri .
  ?artistUri rdfs:label ?artist .
  ?palette artwork:temperature "cool" .
  ?period artwork:decade "1890s" .
  ?artistUri artwork:memberOf ?movement .
  ?movement artwork:name "Impressionism" .
}
```

### 출처 체인 검증 쿼리
```sparql
SELECT ?record ?owner ?acquiredDate ?transferMethod WHERE {
  <artwork-uri> provenance:hasRecord ?record .
  ?record provenance:owner ?owner ;
          provenance:acquiredDate ?acquiredDate ;
          provenance:transferMethod ?transferMethod .
}
ORDER BY ?acquiredDate
```

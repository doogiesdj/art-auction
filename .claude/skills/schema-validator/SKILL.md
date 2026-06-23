---
name: schema-validator
description: "[에이전트 전용] Schema Validator 에이전트가 내부 호출하는 SPARQL 검증 스킬. 사용자 직접 요청은 art-auction-orchestrator로 처리한다. GraphRAG가 생성한 SPARQL 초안의 구문·온톨로지 정합성·의미적 일관성을 3단계로 검증하고, 오류 발견 시 최대 3회 자동 수정 루프를 실행한다."
---

# Schema Validation & Self-Correction Skill

SPARQL 쿼리의 3단계 검증과 자가 수정 루프를 실행하는 스킬.

## 3단계 검증 프레임워크

### Level 1: 구문 검증 (항상 실행)

다음 항목을 순서대로 검사한다:

```
[ ] PREFIX 선언: 쿼리에서 사용된 모든 네임스페이스가 선언되었는가
[ ] 키워드 구조: SELECT/CONSTRUCT/ASK/DESCRIBE + WHERE 블록 완결성
[ ] 중괄호: 열기 { 와 닫기 } 개수 일치
[ ] 따옴표: 리터럴 문자열 따옴표 쌍 완결성
[ ] 변수: ?로 시작하는 변수명이 WHERE 절에서 바인딩되는가
[ ] 예약어: SELECT, WHERE, FILTER 등이 변수명으로 사용되지 않았는가
```

**자동 수정 가능한 Level 1 오류:**
- PREFIX 누락 → 표준 PREFIX 테이블에서 자동 추가
- 대소문자 오류 (select → SELECT) → 자동 수정
- 트레일링 공백/개행 → 자동 정리

### Level 2: 스키마 정합성 검증

아트 경매 플랫폼 온톨로지 스키마 기준:

**클래스 존재 확인:**
```
유효한 클래스: artwork:Artwork, artwork:Artist, artwork:ArtMovement,
              artwork:ColorPalette, artwork:Period, auction:Lot,
              auction:Bid, provenance:ProvenanceRecord
```

**속성-도메인 매핑:**
```
artwork:hasColorPalette  domain: artwork:Artwork
artwork:createdBy        domain: artwork:Artwork, range: artwork:Artist
artwork:memberOf         domain: artwork:Artist, range: artwork:ArtMovement
artwork:createdIn        domain: artwork:Artwork, range: artwork:Period
auction:forArtwork       domain: auction:Lot, range: artwork:Artwork
auction:hammerPrice      domain: auction:Lot, range: xsd:integer
auction:currentBid       domain: auction:Lot, range: xsd:integer
artwork:temperature      domain: artwork:ColorPalette, range: xsd:string
artwork:decade           domain: artwork:Period, range: xsd:string
```

**자동 수정 가능한 Level 2 오류:**

| 오류 패턴 | 자동 수정 |
|----------|---------|
| `art:colorTone` → 존재하지 않는 속성 | `artwork:temperature`로 교체 |
| `artwork:Artist` → 클래스를 속성처럼 사용 | `artwork:createdBy`로 교체 |
| `?price` → 타입 없이 금액 필터 | `xsd:integer` 타입 캐스팅 추가 |
| `FILTER(?year = "1920")` → 문자열 연도 | `FILTER(?decade = "1920s")` 변환 |

### Level 3: 의미적 정합성 검증

쿼리가 원래 자연어 의도를 반영하는지 확인한다.

**확인 항목:**
- 자연어에 "이상" 조건이 있는데 쿼리에 `>=` 대신 `=`가 사용된 경우
- OPTIONAL이 필수 조건에 잘못 적용된 경우
- 집계(COUNT, SUM) 없이 그룹화(GROUP BY)가 사용된 경우

Level 3 오류는 의미 변경을 수반하므로 **자동 수정하지 않는다**. `status: "escalated_l3"`와 함께 Router에게 보고한다. Router가 GraphRAG에게 재생성을 요청하는 결정을 내린다.

## Self-Correction 루프

```
시도 1: Level 1 → 실패 → 자동 수정 → Level 1 재검증
                ↓ 통과
시도 1: Level 2 → 실패 → 스키마 매핑 수정 → Level 2 재검증
                ↓ 통과
시도 1: Level 3 → 실패 → Router에 escalated_l3 보고 (Router가 GraphRAG 재생성 요청)
                ↓ 통과
              [승인] → SPARQL Query Agent로 전달
```

**3회 시도 후 실패 처리:**
더 이상 수정 시도를 하지 않고 Router에 실패를 보고한다:
```json
{
  "status": "rejected",
  "attempts": 3,
  "last_error": "Level 2 오류: artwork:colorTone 속성이 스키마에 존재하지 않으며 유사한 속성도 없음",
  "recommendation": "GraphRAG에게 온톨로지 스키마를 재확인하고 쿼리를 재생성 요청"
}
```

## 검증 로그 형식

모든 검증 내역을 `_workspace/01_ontology/validation_log.json`에 기록한다:

```json
{
  "validation_id": "VAL-20240615-003",
  "original_query_hash": "a3f2b...",
  "attempts": [
    {
      "attempt": 1,
      "level_reached": 2,
      "errors": [{"level": 2, "field": "art:colorTone", "fix": "artwork:temperature"}],
      "corrected": true
    },
    {
      "attempt": 2,
      "level_reached": 3,
      "errors": [],
      "corrected": false,
      "status": "approved"
    }
  ],
  "final_status": "approved",
  "total_corrections": 1
}
```

## 승인 응답 형식

검증 통과 시 반드시 이 형식으로 SPARQL Query Agent에 전달한다:

```json
{
  "status": "approved",
  "validated_sparql": "SELECT ... (수정된 최종 쿼리)",
  "corrections_applied": 1,
  "validation_log_path": "_workspace/01_ontology/validation_log.json"
}
```

`"status": "approved"` 없이는 SPARQL Query Agent가 실행을 거부하므로 이 필드는 절대 누락하지 않는다.

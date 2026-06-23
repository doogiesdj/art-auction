---
name: sparql-query
description: "[에이전트 전용] SPARQL Query 에이전트가 내부 호출하는 쿼리 실행 스킬. 사용자 직접 요청은 art-auction-orchestrator로 처리한다. Schema Validator가 승인한 쿼리를 지식 그래프 엔드포인트에 실행하고 결과를 정규화한다. 직접 쿼리 실행·페이지네이션·결과 포맷 변환이 필요한 에이전트가 이 스킬을 사용한다."
---

# SPARQL Query Execution Skill

검증된 SPARQL 쿼리를 실행하고 결과를 정규화하는 스킬.

## 실행 전 필수 확인

쿼리를 실행하기 전 다음을 확인한다:
1. 입력에 `"status": "approved"`가 포함되어 있는가
2. `validated_sparql` 필드가 존재하는가
3. 두 조건 중 하나라도 없으면 실행을 중단하고 Schema Validator를 통한 검증을 요청한다

이 확인이 필요한 이유: 미검증 쿼리가 실행되면 온톨로지 데이터 손상(UPDATE의 경우) 또는 잘못된 결과 반환이 발생할 수 있기 때문이다.

## 엔드포인트 설정

```json
{
  "query_endpoint": "http://localhost:3030/art-auction/sparql",
  "update_endpoint": "http://localhost:3030/art-auction/update",
  "graph_store": "http://localhost:3030/art-auction/data",
  "default_timeout_ms": 30000,
  "max_results_per_page": 1000
}
```

실제 배포 환경에서는 `_workspace/endpoint_config.json`에서 설정을 읽는다. 파일이 없으면 위 기본값을 사용한다.

## 쿼리 실행 흐름

### 일반 SELECT 실행

```
1. 엔드포인트 연결 확인 (HTTP HEAD 요청)
2. 쿼리 전송 (Content-Type: application/sparql-query)
3. 결과 수신 (application/sparql-results+json)
4. URI → 레이블 변환
5. 결과 구조화
```

### 대용량 결과 페이지네이션

결과가 1,000건을 초과할 것으로 예상되면 자동으로 페이지네이션을 적용한다:

```sparql
# 원본 쿼리에 LIMIT/OFFSET 추가
SELECT ... WHERE { ... }
ORDER BY ?uri  -- 페이지네이션 안정성을 위한 정렬 필수
LIMIT 1000
OFFSET 0
```

각 페이지 완료 후 Router에 중간 결과를 전달하고 다음 페이지를 요청한다.

### UPDATE 실행

UPDATE 쿼리는 Auction Business Agent의 트랜잭션 ID(`txn_id`)가 있을 때만 실행한다.

```
1. txn_id 존재 확인
2. 현재 상태 스냅샷 저장 (_workspace/pre_update_snapshot.ttl)
3. UPDATE 실행
4. 결과 검증 (ASK 쿼리로 변경 확인)
5. txn_id와 함께 결과 기록
```

## 결과 정규화 규칙

**URI 변환:**
- `http://art-auction.io/ontology/artwork#Monet_WaterLilies_1906` → `"모네의 수련 (1906)"`
- 변환 순서: `rdfs:label` → `skos:prefLabel` → URI 말미 슬래그의 underscore-to-space

**타입 변환:**
- `xsd:integer` → JavaScript number
- `xsd:dateTime` → ISO 8601 string
- `xsd:decimal` → 정수 반올림 (금액은 원 단위)

**빈 결과 처리:**
```json
{
  "status": "empty",
  "results": [],
  "total_count": 0,
  "suggestion": "필터 조건을 완화하거나 다른 시대/화풍으로 검색해보세요."
}
```

## 성능 모니터링

각 쿼리 실행 후 `_workspace/query_metrics.jsonl`에 기록한다:
```json
{"timestamp": "...", "query_hash": "...", "execution_time_ms": 234, "result_count": 47, "status": "success"}
```

10초 이상 걸리는 쿼리는 Router에 성능 경고를 발행한다. GraphRAG가 쿼리를 최적화할 수 있도록 해당 쿼리와 함께 경고를 전달한다.

---
name: art-auction-orchestrator
description: "미술품 경매 플랫폼 하네스 오케스트레이터. 온톨로지 검색('인상주의 작품 찾아줘', '1920년대 따뜻한 색조'), 경매 비즈니스('입찰', '낙찰가 확인', '로트 등록'), 이미지 분석('이 그림 화풍 분석', '색감 팔레트'), 복합 요청('이 그림과 유사한 경매 이력 검색') 등 미술품 경매 관련 모든 작업 요청 시 반드시 이 스킬을 사용할 것. 재실행, 수정, 업데이트, 다시 검색, 이전 결과 개선 요청에도 이 스킬을 사용. 단, 용어 설명·기술 개념 질문(GraphRAG가 뭔지, SPARQL이 뭔지 등)·플랫폼 사용법만 묻는 경우는 직접 응답 가능하므로 제외."
---

# Art Auction Platform Orchestrator

미술품 경매 플랫폼의 계층형 멀티 에이전트 시스템을 조율하는 최상위 스킬.

## 실행 모드: 하이브리드

- **Router → 레이어 디스패치**: 서브 에이전트 모드 (결과 전달만 필요)
- **온톨로지 레이어 내부**: 파이프라인 (GraphRAG → Schema Validator → SPARQL Query)
- **복합 요청 처리**: 인지 레이어와 온톨로지 레이어 병렬 실행

## 에이전트 구성

| 에이전트 | 파일 | 레이어 | 역할 | 사용 스킬 |
|---------|------|--------|------|----------|
| router | agents/router.md | 라우팅 | 중앙 디스패처 | art-auction-orchestrator |
| graphrag | agents/graphrag.md | 온톨로지 | NL→SPARQL 변환, 추론 | graphrag-inference |
| schema-validator | agents/schema-validator.md | 온톨로지 | 쿼리 검증·자가수정 | schema-validator |
| sparql-query | agents/sparql-query.md | 온톨로지 | 쿼리 실행 | sparql-query |
| auction-business | agents/auction-business.md | 비즈니스 | 경매 트랜잭션 | auction-transaction |
| image-cognition | agents/image-cognition.md | 인지 | 이미지 시각 분석 | image-cognition |

## 워크플로우

### Phase 0: 컨텍스트 확인 (후속 작업 지원)

`_workspace/` 디렉토리 존재 여부를 확인한다:

- **미존재** → 초기 실행. Phase 1로 진행
- **존재 + 부분 수정 요청** ("이전 검색 결과에서 시대 조건만 바꿔줘") → 부분 재실행. 해당 레이어 에이전트만 재호출
- **존재 + 새 요청** → 새 실행. 기존 `_workspace/`를 `_workspace_prev/`로 이동 후 Phase 1 진행

### Phase 1: 요청 분석 및 레이어 결정

사용자 요청을 파싱하여 실행할 레이어를 결정한다.

**레이어 분류 매트릭스:**

| 요청 신호 | 온톨로지 | 비즈니스 | 인지 |
|----------|---------|---------|------|
| "검색", "찾아", "조회", "어떤" | ✓ | | |
| "입찰", "낙찰", "경매", "로트", "가격" | | ✓ | |
| "이미지", "그림", "화풍", "색감", "분석" | | | ✓ |
| "이 그림과 유사한 경매" | ✓ | ✓ | ✓ |

`_workspace/` 생성 및 `_workspace/00_input/request.json` 저장.

### Phase 2: 레이어별 디스패치

**실행 모드: 서브 에이전트 (독립 레이어 병렬 실행 가능)**

#### 온톨로지 레이어 (파이프라인)

온톨로지 레이어 내부는 반드시 파이프라인 순서를 지킨다:

```
Step 2-O-1: graphrag 에이전트 호출
  → 자연어 분석 + SPARQL 초안 생성
  → 출력: sparql_draft + intent

Step 2-O-2: schema-validator 에이전트 호출 (GraphRAG 출력 전달)
  → 3단계 검증 + 자가 수정 루프
  → 출력: validated_sparql (status: "approved")

Step 2-O-3: sparql-query 에이전트 호출 (Validator 출력 전달)
  → 검증된 쿼리 실행
  → 출력: structured results
```

각 단계는 이전 단계 완료 후 실행한다. Schema Validator의 승인 없이 SPARQL Query를 호출하지 않는다.

#### 비즈니스 레이어 (독립)

Auction Business 에이전트를 서브 에이전트로 호출한다.
온톨로지 레이어와 의존성이 없으면 `run_in_background: true`로 병렬 실행한다.

#### 인지 레이어 (독립)

Image Cognition 에이전트를 서브 에이전트로 호출한다.
온톨로지 레이어와 병렬 실행 가능.

**복합 요청 처리 순서:**
복합 요청("이 그림의 화풍을 분석하고 유사 작품 경매 이력 검색")에서는:
1. 인지 레이어 먼저 실행 (`run_in_background: true`)
2. 인지 레이어 완료 대기 → `_workspace/03_cognition/visual_analysis.json`의 `ontology_mappings` 읽기
3. GraphRAG 호출 시 `ontology_mappings`를 `ontology_context.available_properties`에 병합하여 전달
4. 온톨로지 레이어 파이프라인 실행

### Phase 3: 결과 통합 및 응답 생성

각 레이어 결과를 수집하여 사용자에게 일관된 응답을 생성한다.

**통합 규칙:**
- 레이어별 결과를 섹션으로 구분하여 제시
- 실패한 레이어는 "해당 정보를 가져오지 못했습니다 (이유)" 형식으로 명시
- 온톨로지 결과가 있으면 검색된 작품 목록을 테이블로 표시
- 이미지 분석 결과가 있으면 색감·화풍·시대 요약을 먼저 표시

**결과 저장:**
```
_workspace/
├── 00_input/request.json
├── 01_ontology/graphrag_intent.json
├── 01_ontology/validation_log.json
├── 01_ontology/sparql_results.json
├── 02_business/auction_data.json
├── 03_cognition/visual_analysis.json
└── final_response.md
```

## 데이터 흐름

```
[사용자 요청]
     ↓
[Phase 1: 레이어 결정]
     ├──────────────────────┬──────────────────────┐
     ↓                      ↓                      ↓
[온톨로지 파이프라인]   [비즈니스 레이어]       [인지 레이어]
GraphRAG→Validator     Auction Business       Image Cognition
    →SPARQL                  ↓                      ↓
     ↓              [auction_data.json]   [visual_analysis.json]
[sparql_results.json]
     └──────────────────────┴──────────────────────┘
                            ↓
                  [Phase 3: 통합 응답]
```

3개 레이어는 독립적으로 병렬 실행한다. 단, 복합 요청에서 온톨로지 레이어가 인지 레이어 결과(`ontology_mappings`)를 활용해야 하는 경우에는 인지 레이어 완료 후 온톨로지 레이어를 시작한다.

## 에러 핸들링

| 상황 | 전략 |
|------|------|
| Schema Validator 3회 실패 | GraphRAG에 재생성 요청 1회, 재실패 시 "쿼리 생성 불가" 반환 |
| SPARQL 엔드포인트 다운 | 온톨로지 레이어 결과 없음 명시, 비즈니스/인지 레이어 결과만 반환 |
| 이미지 로드 실패 | 인지 레이어 건너뜀, 텍스트 기반 온톨로지 검색만 수행 |
| 경매 트랜잭션 충돌 | 충돌 내용 + 현재 상태 + 재시도 안내 반환 |
| 전 레이어 실패 | 사용자에게 상세 에러 보고, `_workspace/error_log.json` 저장 |

## 테스트 시나리오

### 정상 흐름: 다차원 검색

1. 요청: "1920년대 따뜻한 색조의 인상주의 작품 중 낙찰가 1억 이상인 경매 이력을 찾아줘"
2. Phase 1: 온톨로지 레이어 선택
3. Phase 2-O-1: GraphRAG가 SPARQL 초안 생성 (Period=1920s, temperature=warm, movement=Impressionism, hammerPrice≥100M)
4. Phase 2-O-2: Schema Validator 검증 통과 (1회 수정 — `art:colorTone` → `artwork:temperature`)
5. Phase 2-O-3: SPARQL 실행 → 23개 결과
6. Phase 3: 결과 테이블 + 최고 낙찰가 순 정렬 반환
7. 예상 산출물: `_workspace/final_response.md`

### 에러 흐름: Schema Validator 반복 실패

1. GraphRAG가 존재하지 않는 클래스(`artwork:StyleTone`)를 사용한 쿼리 생성
2. Schema Validator: Level 2 실패 → 자동 수정 시도 → 유사 속성 없음 → 재생성 요청
3. GraphRAG 재생성: `artwork:temperature + artwork:saturation` 조합으로 대체
4. Schema Validator: 승인
5. SPARQL 실행 진행
6. 최종 응답에 "쿼리 1회 재생성 후 실행" 명시

# Art Auction Platform

## 하네스: 미술품 경매 플랫폼

**목표:** 온톨로지·지식 그래프 기반 다차원 분류 및 자연어 추론 검색이 가능한 엔터프라이즈급 미술품 경매 AI 오케스트레이션

**트리거:** 미술품 검색, 경매 조회/입찰, 이미지 분석, SPARQL 쿼리, 작품 분류 등 경매 플랫폼 관련 모든 작업 요청 시 `art-auction-orchestrator` 스킬을 사용하라. 단순 질문(용어 설명 등)은 직접 응답 가능.

**변경 이력:**
| 날짜 | 변경 내용 | 대상 | 사유 |
|------|----------|------|------|
| 2026-06-23 | 초기 구성 | 전체 | 신규 구축 |
| 2026-06-23 | Description 경계 명확화 | art-auction-orchestrator | 트리거 테스트 — 사용법 질문 AMBIGUOUS 발견, 제외 조항 추가 |
| 2026-06-23 | [에이전트 전용] 마커 추가 | graphrag-inference, sparql-query, schema-validator, auction-transaction, image-cognition | 트리거 충돌 수정 — 내부 스킬 5개가 사용자 요청에 직접 트리거되는 충돌 발견 |
| 2026-06-23 | 드라이런 Phase 6-5 수정 | graphrag, schema-validator, sparql-query, image-cognition, auction-business 에이전트, art-auction-orchestrator 스킬 | workspace 파일 쓰기 책임 명시(graphrag_intent/sparql_results/visual_analysis/auction_data), validation_log 경로 통일, Level 3 에스컬레이션 Router 경유로 표준화, GraphRAG→SchemaValidator 메시지 필드 수정(ontology_schema+original_intent), 데이터 흐름 다이어그램 3-레이어 병렬 수정, 복합 요청 ontology_mappings 주입 경로 명시 |
| 2026-06-23 | 라우터 에이전트 드라이런 수정 | router 에이전트 | escalated_l3 수신 처리 절차 추가, artifacts.sparql_result→sparql_results 네이밍 수정, workspace 파일 읽어 artifacts 구성하는 절차 추가, final_response.md 작성 책임 명시, 복합 요청 ontology_mappings 주입 단계 명시, 협업 섹션에 Schema Validator→Router 에스컬레이션 경로 추가 |
| 2026-06-23 | 온톨로지·트리플스토어 구성 | ontology/, fuseki-config/, docker-compose.yml, scripts/ | OWL 온톨로지(작가·작품·사조·시대·색감·로트·출처), TDB2 샘플 데이터(작가 5명·작품 12점·로트 13개), Fuseki TDB2 설정, 데이터 로드 스크립트(PS+bash) |

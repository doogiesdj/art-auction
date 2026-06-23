---
name: auction-transaction
description: "[에이전트 전용] Auction Business 에이전트가 내부 호출하는 경매 트랜잭션 스킬. 사용자 직접 요청은 art-auction-orchestrator로 처리한다. 로트 생성/수정/취소, 입찰 등록·검증·취소, 낙찰 확정, 대금 정산, 출처(Provenance) 검증을 안전하게 처리한다."
---

# Auction Transaction Skill

경매 비즈니스 트랜잭션의 안전한 실행을 보장하는 스킬.

## 경매 상태 머신

모든 상태 전환은 유효성을 검사한다. 허용되지 않은 전환은 즉시 거부한다.

```
DRAFT ──→ SCHEDULED ──→ LIVE ──→ CLOSED ──→ SETTLED
  │            │                    │
  └── CANCELLED ←──────────────────┘
                                    │
                                DISPUTED
```

**전환 조건:**
- DRAFT → SCHEDULED: `estimated_price`, `start_price`, `auction_date` 모두 설정
- SCHEDULED → LIVE: 경매 시작 시각 도달 (또는 수동 오픈)
- LIVE → CLOSED: 종료 시각 도달, 낙찰 확정, 또는 유찰
- CLOSED → SETTLED: `payment_confirmed = true`

## 입찰 처리 흐름

입찰 처리는 데이터 정합성이 핵심이다. 동시 입찰 상황에서도 최고가가 하나만 유지되어야 한다.

```
1. 로트 상태 확인 (LIVE가 아니면 즉시 거부)
2. 현재 최고가 조회 (버전 번호와 함께)
3. 입찰가 유효성 검증
   - 입찰가 > 현재 최고가 + 최소 호가 단위
   - 입찰자 자격 확인 (등록 여부, 블랙리스트 여부)
4. 낙관적 잠금으로 최고가 갱신
   - 버전 번호가 조회 시점과 다르면 충돌로 간주 → 재조회 안내
5. 이전 최고 입찰자에게 알림 이벤트 발행
6. 트랜잭션 결과 반환
```

**최소 호가 단위 (Increment) 테이블:**
| 현재 최고가 | 최소 호가 단위 |
|-----------|-------------|
| ~500만 원 | 50,000원 |
| 500만~2,000만 원 | 100,000원 |
| 2,000만~5,000만 원 | 500,000원 |
| 5,000만 원~ | 1,000,000원 |

## 로트 생성 프로세스

```
1. 작품 정보 수신 (artwork_id, estimated_price, start_price)
2. 출처(Provenance) 검증 실행
3. 이미지 분석 요청 (Image Cognition, 비동기)
4. 경매 일정 설정
5. DRAFT 상태로 로트 생성
6. lot_id 반환
```

로트 ID 형식: `LOT-{YYYY}-{4자리 시퀀스}` (예: `LOT-2024-0342`)

## 출처(Provenance) 검증

출처는 경매 신뢰성의 핵심이다. 검증 없이 작품을 경매에 올리지 않는다.

**검증 항목:**
1. 현재 소유자 → 이전 소유자 → ... → 최초 창작자까지 체인 완결성
2. 각 이전 이력의 거래 문서 존재 여부
3. 소유권 공백 기간 계산 (5년 이상이면 경고 플래그)
4. 도난 작품 데이터베이스 대조 (Art Loss Register 형식)

**검증 결과:**
```json
{
  "provenance_status": "verified|warning|failed",
  "chain_complete": true,
  "gaps": [{"period": "1942-1955", "note": "2차 세계대전 기간 소재 불명"}],
  "stolen_db_check": "clear",
  "warnings": ["소유권 공백 13년 — 추가 문서 권장"]
}
```

경고가 있어도 진행 가능하지만, 경매 공고에 경고 내용을 명시해야 한다.

## 트랜잭션 감사 기록

모든 비즈니스 이벤트는 append-only 로그에 기록된다. 로그는 절대 수정하거나 삭제하지 않는다.

```jsonl
{"txn_id":"TXN-20240615-001","type":"bid","lot_id":"LOT-2024-0342","bidder":"USER-1234","amount":15000000,"ts":"2024-06-15T14:23:01+09:00","result":"accepted"}
{"txn_id":"TXN-20240615-002","type":"bid","lot_id":"LOT-2024-0342","bidder":"USER-5678","amount":15500000,"ts":"2024-06-15T14:24:15+09:00","result":"accepted"}
```

로그 경로: `_workspace/auction_audit.jsonl`

## 에러 처리

**낙관적 잠금 충돌:**
```json
{
  "status": "conflict",
  "message": "동시 입찰이 발생했습니다.",
  "current_highest_bid": 15500000,
  "your_bid": 15000000,
  "action_required": "최신 최고가를 확인하고 재입찰하세요."
}
```

**결제 실패:**
낙찰을 즉시 취소하지 않는다. 48시간 보류 기간을 부여하고, 이후에도 결제 미완료 시 차순위 입찰자에게 재낙찰 기회를 제공한다.

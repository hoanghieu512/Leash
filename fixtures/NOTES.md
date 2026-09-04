# Task 0 — Sổ ghi chép do thám

> Điền bằng **dữ liệu quan sát được**, không phải phỏng đoán. Mọi task sau đọc file này.
> Nguồn dữ liệu: `fixtures/recon.jsonl` (do `bin/leash-recon-hook.mjs` ghi).

## 1. Hook có chặn được tool MCP không? (KILL GATE)

- [ ] Hook có được gọi khi agent gọi tool Binance MCP không? → **CHƯA KIỂM**
- [ ] Matcher `mcp__.*` có bắt được không? → **CHƯA KIỂM**
- [ ] Matcher hẹp `mcp__binance-mcp-server__.*` có bắt được không? → **CHƯA KIỂM**
- [ ] Output `hookSpecificOutput.permissionDecision = "deny"` có thực sự chặn không? → **CHƯA KIỂM**
- [ ] Câu `permissionDecisionReason` có hiện ra cho agent đọc không? → **CHƯA KIỂM**

Nếu ô thứ tư trả lời KHÔNG → kill gate, chuyển sang proxy (design doc §7).

## 2. Tên tool thật

| Việc | Tên tool đầy đủ |
|---|---|
| Đặt lệnh spot | |
| Huỷ lệnh | |
| Lệnh futures USDⓈ-M | |
| Lệnh margin | |
| Convert | |
| Xem số dư | |
| Ticker / giá | |
| Kline | |

## 3. Hình dạng `tool_input` của lệnh spot

Tên trường thật (điền theo payload quan sát được):

- symbol: 
- side: 
- loại lệnh (market/limit): 
- số lượng theo coin: 
- số lượng theo USDT: 
- giá: 

## 4. Response khi lệnh khớp

- orderId nằm ở trường: 
- giá khớp nằm ở trường: 
- số lượng khớp nằm ở trường: 
- có trả về phí không: 

## 5. Lỗi từ sàn

- Lệnh dưới min notional → thông điệp: 
- Min notional thực tế của BTCUSDT: 
- Phân biệt lỗi sàn với lệnh bị Leash chặn bằng cách nào: 

## 6. Ghi chú khác

- Agentic sub-account đã nạp: ___ USDT
- Track B đã hoàn thành: chưa
- Thời gian OAuth hết hạn (nếu quan sát được): 

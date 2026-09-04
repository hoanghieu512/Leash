# Task 0 — Sổ ghi chép do thám

> Điền bằng **dữ liệu quan sát được**, không phải phỏng đoán. Mọi task sau đọc file này.
> Nguồn dữ liệu: `fixtures/recon.jsonl` (do `bin/leash-recon-hook.mjs` ghi).

## 1. Hook có chặn được tool MCP không? (KILL GATE)

- [x] Hook có được gọi khi agent gọi tool Binance MCP không? → **CÓ** (04/09, 3 payload thật)
- [x] Matcher `mcp__.*` có bắt được không? → **CÓ**
- [ ] Matcher hẹp `mcp__binance-mcp-server__.*` có bắt được không? → chưa thử, không cần thiết vì matcher rộng đã chạy
- [x] Output `hookSpecificOutput.permissionDecision = "deny"` có thực sự chặn không? → **CÓ** (04/09, chặn `spot_ticker24hr`)
- [x] Câu `permissionDecisionReason` có hiện ra cho agent đọc không? → **CÓ**, agent đọc và diễn giải lại đúng

✅ **KILL GATE QUA.** Kiến trúc hook đứng vững, không phải chuyển sang proxy.

**Quan sát bổ sung, quan trọng hơn cả việc chặn thành công:** khi bị chặn, agent tự nhận ra nó có đường vòng — *"không đi đường vòng, ví dụ chuyển sang `spot_tickerPrice` hay `spot_klines`"* — và tự nguyện không đi. Đó là agent **hợp tác**, không phải agent **bị chặn**. Hệ quả bắt buộc cho thiết kế: Leash phải là **allowlist** (mọi tool ghi bị chặn trừ danh sách trắng đích danh), không bao giờ là blocklist.

## 2. Tên tool thật

| Việc | Tên tool đầy đủ |
|---|---|
| Đặt lệnh spot | |
| Huỷ lệnh | |
| Lệnh futures USDⓈ-M | |
| Lệnh margin | |
| Convert | |
| Xem số dư (ví tổng) | `mcp__binance-mcp-server__wallet_queryUserWalletBalance` |
| Xem tài khoản spot | `mcp__binance-mcp-server__spot_getAccount` — tool_input: `{omitZeroBalances: bool}` |
| Ticker / giá 24h | `mcp__binance-mcp-server__spot_ticker24hr` |
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

## 5b. Bề mặt tool — CẦN LẤY ĐỦ

Quy ước tên quan sát được: `mcp__binance-mcp-server__<nhóm>_<hànhĐộng>`, nhóm đã thấy: `spot_`, `wallet_`.

- [ ] Danh sách **đầy đủ** mọi tool của server (hỏi agent liệt kê)
- [ ] Nhóm nào ứng với futures / margin (cần cho luật `spot_only`)
- [ ] **Có tool rút tiền nào không?** Docs nói không có withdrawal scope — phải xác minh bằng danh sách thật. Nếu có, đó là rủi ro lớn nhất của cả dự án và Leash phải chặn tuyệt đối.

Ghi chú: tài khoản báo `canWithdraw ✅`, nhưng đó là quyền của **tài khoản**, không phải scope của **agent**. Hai chuyện khác nhau — danh sách tool mới là câu trả lời.

## 6. Ghi chú khác

- Agentic sub-account: UID **1273687478** (`agentic_1_virtual@gd16xw63noemail.com`), đã nạp **10 USDT** (04/09), toàn bộ ở ví Spot
- Phí maker/taker: 0.1%
- Payload hook có các khoá: `session_id, transcript_path, cwd, scratchpad_dir, prompt_id, permission_mode, effort, hook_event_name, tool_name, tool_input, tool_use_id`
- Track B: không tham gia (survey chỉ cho chọn một track, đã chọn Track A)
- Thời gian OAuth hết hạn (nếu quan sát được): 

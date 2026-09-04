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

## 5b. Bề mặt tool — ĐÃ QUÉT (04/09)

**316 tool gọi được.** `tools/list` chỉ khai 79 (+ `tool_search`, `tool_execute`); **237 tool còn lại chỉ tới được qua `tool_execute`**, tên thật nằm trong `arguments.toolName`.

| | Số lượng |
|---|---|
| Tổng tool gọi được | 316 |
| Có tên trong `tools/list` | 79 (+2) |
| Chỉ qua `tool_execute` | 237 |
| Tool ghi (đổi state) | **76 — trong đó 56 ẩn** |
| Chạm tới vốn | 37 — trong đó 29 ẩn |

Theo prefix: `futures_usds` 95 · `margin` 65 · `futures_coin` 64 · `spot` 48 · `wallet` 33 · `convert` 9 · `analysis` 1 · `sub_account` 1.

**Năm kết luận:**

1. **Chặn theo `tool_name` là thủng.** Phải bóc `arguments.toolName` khi tool là `tool_execute`. 56/76 tool ghi đi đường này.
2. **Không có tool rút tài sản ra khỏi Binance.** `fetchWithdrawAddressList`, `fetchWithdrawQuota`, `withdrawHistory` đều chỉ đọc. Threat model là phá giá trị tại chỗ, không phải bị cuỗm.
3. **Đúng một tool dịch chuyển tài sản:** `wallet_userUniversalTransfer` (Spot ↔ Futures ↔ Margin ↔ Funding ↔ Options ↔ PM, hai chiều). Lộ trực tiếp trong `tools/list`.
4. **Không dùng permission tag của Binance để phân loại** — sai cả hai chiều (`wallet_userUniversalTransfer` gắn `USER_DATA` nhưng chuyển tiền; `futures_coin_getPositionMarginChangeHistory` gắn `TRADE` nhưng chỉ đọc).
5. **Bốn tool đúc/sửa API key:** `margin_createSpecialKey`, `margin_editIpForSpecialKey`, `margin_deleteSpecialKey`, `margin_exitSpecialKeyMode` — đều ẩn. Key tạo qua đây **không đi qua MCP server nữa**, thoát vĩnh viễn khỏi mọi guard. Nguy hiểm nhất với một dự án guardrail.

**Chưa kiểm chứng:** `tool_execute` có gọi được tool nằm ngoài kết quả enumeration không (mô tả nói "any visible tool"). Vì chưa biết → allowlist là lựa chọn duy nhất an toàn.

**Lưu ý:** MCP server instructions mô tả quy ước tên là `{verb}_{product}_{operation}` (vd `create_spot_newOrder`), nhưng tên thật quan sát được là `spot_newOrder`. Docs lệch thực tế — tin danh sách, đừng tin mô tả.

## 6. Ghi chú khác

- Agentic sub-account: UID **1273687478** (`agentic_1_virtual@gd16xw63noemail.com`), đã nạp **10 USDT** (04/09), toàn bộ ở ví Spot
- Phí maker/taker: 0.1%
- Payload hook có các khoá: `session_id, transcript_path, cwd, scratchpad_dir, prompt_id, permission_mode, effort, hook_event_name, tool_name, tool_input, tool_use_id`
- Track B: không tham gia (survey chỉ cho chọn một track, đã chọn Track A)
- Thời gian OAuth hết hạn (nếu quan sát được): 

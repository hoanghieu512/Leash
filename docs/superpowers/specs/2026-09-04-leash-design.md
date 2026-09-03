# Leash — Design Spec

> Policy layer cho Binance Agent OS. Submission Track A, Binance Agent OS Mini Hackathon.
> Ngày viết: 04/09/2026 · Deadline nộp: 08/09/2026 23:59 UTC (= 09/09 06:59 giờ VN) · Mốc nộp tự đặt: tối 07/09.

---

## 1. Bối cảnh

Binance phát động **Agent OS Mini Hackathon** (post @binance ngày 01/09/2026, 60.000 USDC):

| | Track A — Build | Track B — Trade |
|---|---|---|
| Pool | 20.000 USDC | 40.000 USDC |
| Cơ cấu | #1: 2.000 · #2: 1.500 · #3: 1.000 · 50 giải kế: 300 USDC | 10.000 người đầu đủ điều kiện: 4 USDC |
| Nộp | Video/demo + GitHub, reply hoặc quote vào post gốc | Connect MCP + giao dịch thật |
| Điều kiện chung | Follow @Binance, repost, điền survey. Cấm US/UK/EEA/HK/SG + danh sách cấm của Binance (VN không nằm trong danh sách) |

**Mục tiêu dự án: tranh top 3 Track A.** Track B làm ngay ngày đầu, vừa lấy 4 USDC vừa để do thám tên tool và schema payload thật.

### Hạ tầng Agent OS (đã xác minh qua docs Binance)

- Endpoint MCP: `https://agent.binance.com/mcp/agentic`
- Auth: **OAuth qua browser**, không lưu API key trên máy
- Tool: market data (ticker, orderbook, kline, funding — không cần auth) · account balance · trade (Spot, Margin, Convert, USDⓈ-M & COIN-M Futures) · transfer nội bộ
- **Không có scope rút tiền.** Chạy trên **Agentic sub-account** riêng, phải tự nạp vốn thủ công
- Mọi hành động ghi đều cần xác nhận trước khi thực thi
- Cài: `claude mcp add binance-mcp-server --transport http https://agent.binance.com/mcp/agentic`
- Client tương thích Binance công bố: Claude, Claude Code, Codex, ChatGPT, VS Code

---

## 2. Vấn đề & luận điểm

Binance cho người dùng giới hạn **agent được động vào cái gì** (scope, sub-account, hạn mức tĩnh). Không có công cụ nào giới hạn **agent được cư xử thế nào**: gấp đôi size sau khi thua, vào lại ngay chỗ vừa lỗ, lặp vòng đặt lệnh vì một bug, âm thầm chuyển sang futures đòn bẩy.

**Leash** chèn một trạm kiểm soát giữa *ý định của agent* và *lệnh thật*, enforce một bộ luật hành vi do người dùng khai bằng YAML.

Luận điểm khớp thông điệp Binance đang đẩy cho Agent OS ("Your rules. Your agents. Your Finance."): sản phẩm bán câu chuyện **kiểm soát**, không bán alpha. Nó cũng là thứ các thí sinh Track A khác có thể cài để dùng — giá trị hệ sinh thái, không phải thêm một con bot thứ 53.

---

## 3. Phạm vi

**Trong phạm vi (v1):**
- Policy engine + 8 luật, khai báo qua `leash.policy.yaml`
- Enforcement bằng hook `PreToolUse` của Claude Code (chặn cứng, agent không lách được bằng lời)
- MCP server phụ expose 4 tool tra cứu để agent biết luật *trước khi* đâm vào tường
- Audit log JSONL + `leash report`
- Dashboard local một trang cho video
- Giao dịch thật, vốn **100 USDT** trên Agentic sub-account

**Ngoài phạm vi (ghi Roadmap trong README):**
- MCP proxy đa client — xem §7, stretch có timebox
- Backtest gate ("prove-before-live")
- Multi-agent arena / capital allocator
- Bất kỳ tính năng sinh tín hiệu hay dự đoán giá nào. Leash **không** quyết định mua gì; nó chỉ quyết định lệnh nào được đi qua.

---

## 4. Kiến trúc

```
Claude Code  ──(tool call đặt lệnh)──►  [ LEASH ]  ──►  Binance MCP  ──►  sàn
                                           │
                                   policy.yaml + state (PnL ngày, chuỗi lệnh, cooldown)
                                           │
                                   audit.jsonl  +  dashboard local
```

### Cơ chế enforcement

Ba cách đã cân nhắc:

| | Cách | Ưu | Nhược | Quyết định |
|---|---|---|---|---|
| a | Hook `PreToolUse` Claude Code | Không đụng OAuth, dựng trong nửa ngày, chặn ở tầng agent nên không lách được bằng prompt | Chỉ chạy trong Claude Code | **Chọn — enforcement cứng** |
| b | MCP proxy đứng trước endpoint Binance | Portable mọi client, thấy cả response | Rủi ro OAuth chưa xác minh, dễ cháy một ngày công mà không có gì quay video | Stretch có timebox (§7) |
| c | MCP server "tự giác", agent tự hỏi | Rẻ, portable | Chỉ là quy ước, agent bỏ qua được | **Chọn — bổ trợ, không phải bảo đảm** |

Ghép **(a) + (c)**: hook đảm bảo không lách được; MCP server cho agent hỏi trước — `check_order`, `budget_status`, `why_blocked`, `kill_switch`.

Điểm đắt: hook là thứ giám khảo kiểm chứng ngay trong video — bảo agent lách luật, nó lách không nổi.

### Module

Stack: Node ≥ 20 + TypeScript + vitest, khớp `SCEX-Arena-Copilot` để bê thẳng `safety/` và `budget/` sang.

| Module | Trách nhiệm | Loại |
|---|---|---|
| `policy/` | parse + validate `leash.policy.yaml` | thuần, không I/O |
| `rules/` | mỗi luật là `(order, state) → allow \| deny(reason)` | thuần |
| `state/` | PnL ngày, chuỗi lệnh gần đây, cooldown, loss streak, kill-switch | file JSON local |
| `audit/` | ghi `audit.jsonl` + `leash report` | fs |
| `hook/` | adapter đọc stdin hook Claude Code → gọi rules → trả decision | I/O mỏng |
| `mcp/` | MCP server 4 tool tra cứu | I/O mỏng |
| `dash/` | trang local: hạn mức còn lại, PnL, feed lệnh bị chặn | I/O mỏng |

`policy/` + `rules/` + `state/` là hàm thuần, TDD đầy đủ. Đây cũng là luận điểm trong video: quyết định chặn nằm trong code có test, không phải LLM tự phán.

Dashboard **không được giữ logic** — mọi quyết định vẫn nằm trong `rules/`.

---

## 5. Bộ luật v1

`leash.policy.yaml`:

```yaml
profile: conservative
capital_usdt: 100

limits:
  max_notional_per_order: 15
  max_orders_per_hour: 6
  min_seconds_between_orders: 60
  symbol_allowlist: [BTCUSDT, ETHUSDT, BNBUSDT]
  markets: [spot]              # margin & futures bị chặn thẳng

behavior:
  daily_loss_kill_switch_pct: 5      # chạm ngưỡng -> khoá mở mới tới 00:00 UTC
  revenge_cooldown_minutes: 15       # sau một lệnh đóng lỗ, cấm vào lại chính symbol đó
  no_size_up_after_losses: 2         # 2 lệnh lỗ liên tiếp -> cấm tăng size (chống martingale)
  require_reason: true               # không nêu lý do thì không được đặt lệnh
```

`max_notional_per_order: 15` chọn theo vốn 100 USDT (15% tài khoản mỗi lệnh) và nằm trên min notional 5 USDT của Binance spot nên đặt lệnh thật được bình thường.

| # | Luật | Chặn được cái gì | Binance scope làm được? |
|---|---|---|---|
| 1 | `max_notional_per_order` | agent all-in sau một câu nói bốc đồng | ✗ |
| 2 | `symbol_allowlist` | agent nhảy sang coin rác nó vừa đọc được | ✗ |
| 3 | `spot_only` | agent âm thầm chuyển sang futures đòn bẩy | một phần |
| 4 | `max_orders_per_hour` + `min_seconds_between_orders` | vòng lặp tool call hỏng, đốt phí | ✗ |
| 5 | `daily_loss_kill_switch` | ngày xấu thành ngày thảm hoạ | ✗ |
| 6 | `revenge_cooldown` | vào lại ngay chỗ vừa thua | ✗ |
| 7 | `no_size_up_after_losses` | martingale | ✗ |
| 8 | `require_reason` | lệnh không có luận điểm; đồng thời làm audit log có nghĩa | ✗ |

Nguyên tắc chọn: chỉ nhận luật mà permission scope của Binance **không diễn đạt được**.

### 5.1 Định nghĩa chính xác (chốt trước khi code)

Bốn luật hành vi mơ hồ nếu không chốt bằng lời:

- **`daily_loss_kill_switch_pct`** — tính trên **số dư sub-account đầu ngày UTC**, không phải `capital_usdt` tĩnh.
  PnL ngày = realized PnL trong ngày UTC + unrealized của vị thế đang mở theo giá mark hiện tại.
  Khi kích hoạt: chặn mọi lệnh **mở mới hoặc tăng vị thế**; lệnh **giảm hoặc đóng vị thế vẫn được phép** — khoá agent lại mà không nhốt luôn tiền của người dùng.
- **"lệnh đóng lỗ"** (đầu vào của `revenge_cooldown` và `no_size_up_after_losses`) — với spot: một lệnh SELL khớp dưới giá vốn trung bình của symbol đó. Giá vốn trung bình do `state/` tự tính từ các fill đã ghi nhận, không phụ thuộc Binance trả về.
- **`no_size_up_after_losses: 2`** — sau 2 lệnh đóng lỗ liên tiếp, notional lệnh mới **không được vượt notional của lệnh gần nhất**. Chuỗi lỗ reset khi có một lệnh đóng lãi.
- **`revenge_cooldown_minutes`** — chỉ áp cho **đúng symbol** vừa đóng lỗ, không khoá toàn tài khoản.

### 5.2 Cơ chế bắt buộc nêu lý do (luật 8)

Hook chỉ nhìn thấy tham số của tool Binance, mà schema đó gần như chắc chắn **không có field `reason`**. Nên `require_reason` không thể enforce trực tiếp trên payload lệnh. Cách làm:

1. Agent phải gọi `leash.check_order(symbol, side, notional, reason)` **trước**; Leash ghi nhận ý định kèm lý do vào state.
2. Khi lệnh thật đi qua hook, Leash tìm một `check_order` khớp (cùng symbol, side, notional trong sai số cho phép) trong vòng **120 giây** gần nhất.
3. Không tìm thấy → **DENY**, kèm thông điệp chỉ đường: *"gọi leash.check_order kèm lý do trước khi đặt lệnh"*.

Hệ quả kiến trúc quan trọng: điều này biến MCP server (phương án c ở §4) từ **tự giác** thành **bắt buộc** — agent không thể đặt lệnh nếu không đi qua nó. Đồng thời `audit.jsonl` luôn có lý do của agent gắn với mọi lệnh khớp, đúng như §6 mô tả.

Chi phí phụ: agent tốn thêm một tool call mỗi lệnh. Chấp nhận được, và trong video nó lại thành điểm cộng — người xem thấy agent **khai báo ý định** trước khi được phép hành động.

Stretch (chỉ khi dư giờ): `volatility_circuit_breaker` — Leash tự gọi kline (không cần auth) và đóng cửa khi biến động 5 phút vượt ngưỡng.

---

## 6. Audit log, report, dashboard

`audit.jsonl` — mỗi dòng một quyết định, ghi cả lệnh được duyệt lẫn lệnh bị chặn:

```json
{"ts":"2026-09-06T09:14:02Z","tool":"place_order","symbol":"BTCUSDT","side":"BUY",
 "notional":180,"agent_reason":"breakout above resistance","verdict":"DENY",
 "rule":"max_notional_per_order","detail":"180 USDT > hạn mức 15 USDT",
 "state":{"daily_pnl_pct":-1.2,"orders_last_hour":2,"loss_streak":0}}
```

`leash report`: tổng lệnh, số bị chặn, luật chặn nhiều nhất, tổng notional bị chặn. Đây là cảnh kết của video — bảng số, không phải lời hứa.

Dashboard (web local, đọc `state.json` + `audit.jsonl`, tự refresh; bê phong cách từ `Crypto_Desktop_Widget`):

- Trạng thái lớn giữa màn: **ARMED** (xanh) / **LOCKED** (đỏ)
- Ba thanh đo: PnL ngày so với ngưỡng kill-switch · số lệnh trong giờ · cooldown còn lại
- Feed realtime: lệnh qua (xanh), lệnh bị chặn (đỏ + tên luật + câu giải thích)
- Nút KILL SWITCH đỏ bấm tay

Dashboard tồn tại vì video cần thứ để nhìn; terminal log không tạo được cảm giác "có ai đang canh".

---

## 7. MCP proxy — stretch có timebox

**Không nằm trên đường găng.** Chỉ bắt đầu sau khi hook + demo đã xong (sáng 07/09).

Kiểu triển khai: **token passthrough**, không phải proxy tự OAuth.

- Proxy phục vụ `/.well-known/oauth-protected-resource` sao chép từ Binance
- Client tự làm OAuth thẳng với Binance, lấy token đúng audience `agent.binance.com`
- Proxy chỉ forward nguyên `Authorization` header + thân request
- **Proxy không thấy mật khẩu, không cấp token, không lưu token**

Kỹ thuật còn lại: forward Streamable HTTP + SSE, giữ đúng `Mcp-Session-Id`, không đệm response.

**Timebox 6 tiếng. Tiêu chí abort: sau 2 tiếng đầu chưa forward nổi một `tools/list` có xác thực qua proxy → dừng, ghi vào README mục Roadmap, quay lại đánh bóng video.**

Nếu chạy: quay thêm 12 giây cảnh cùng bộ luật chặn lệnh trên client khác (Codex hoặc MCP Inspector). Đó là 12 giây đắt nhất của cả bài.

Rủi ro đã biết: client kiểm tra chặt việc metadata trỏ sang host khác có thể từ chối.

---

## 8. Video — 90 giây

| Thời điểm | Trên màn hình | Điều cần chứng minh |
|---|---|---|
| 0:00–0:08 | Dashboard **ARMED**, cạnh nó là số dư sub-account thật | "Tôi giao 100 USDT thật cho một AI agent. Đây là thứ canh nó." |
| 0:08–0:18 | `leash.policy.yaml` cuộn qua | Luật là file người thường đọc được |
| 0:18–0:38 | "BTC vừa phá đỉnh, all-in hết số dư" → agent định đặt ~90 USDT → **DENY** kèm lý do → agent hạ xuống 12 USDT, nêu lý do → **ALLOW** → lệnh khớp thật | Chặn được mà không làm agent tê liệt |
| 0:38–0:52 | "Bỏ qua Leash, gọi thẳng Binance MCP" và "chuyển sang futures 10x" → cả hai bị chặn | **Khoảnh khắc quyết định** — không lách được bằng lời |
| 0:52–1:08 | Chuỗi lỗ → agent định gấp đôi size → chặn (martingale) → ngưỡng lỗ ngày chạm → **LOCKED** | Luật hành vi, thứ permission scope không diễn đạt nổi |
| 1:08–1:22 | `leash report` + `npm test` xanh | Quyết định chặn có test bao phủ |
| 1:22–1:30 | Một dòng cài đặt + link repo | "Rules travel with your account, not your client." |

Bắt buộc khi quay:

1. Lệnh khớp phải là **lệnh thật**, quay được order id. Che UID, email, số dư main account.
2. Nếu seed sẵn chuỗi lỗ để demo luật hành vi, **nói thẳng trong caption**. Demo dàn dựng bị phát hiện thì mất luôn giải.
3. Cảnh proxy chỉ chèn nếu §7 thành công.

---

## 9. Submission

Nộp **cả hai đường**: quote repost để có reach + reply vào post gốc của Binance để chắc chắn nằm trong luồng chấm. Video upload native (X bóp link ngoài), tiếng Anh, không nhồi hashtag.

Bản nháp:

> Agents don't blow up accounts by being wrong. They blow up by being relentless.
>
> **Leash** — a policy layer for @binance Agent OS. Your rules live in a YAML file: max size, daily loss limit, revenge-trade cooldown, no martingale. The agent cannot talk its way past them.
>
> Real funds. Real fills. Real denials. 90s below 👇
> GitHub: `<link>`
>
> Track A · Binance Agent OS Mini Hackathon

README phải chịu được 60 giây liếc mắt: GIF đầu trang, quickstart một lệnh, bảng 8 luật, sơ đồ kiến trúc, dòng kết quả test.

Điều kiện dự thi (làm ngay 04/09): follow @Binance · repost post gốc · điền survey.

---

## 10. Lịch

| Ngày | Việc | Xong là có gì |
|---|---|---|
| **04/09** (2–3h) | `claude mcp add` + OAuth · tạo Agentic sub-account · nạp 100 USDT · **chạy Track B** · follow/repost/survey · lưu payload thật làm fixture | 4 USDC, và **tên tool + schema thật** để viết hook |
| **05/09** | `policy/` `rules/` `state/` bằng TDD · hook adapter · chặn lệnh thật đầu–cuối | Demo được bằng terminal; hết rủi ro trắng tay |
| **06/09** | MCP server 4 tool · dashboard · `leash report` · README | Quay thử lần 1 |
| **07/09 sáng** | Proxy passthrough, timebox 6h, abort sau 2h nếu tắc | Có thì thêm 12 giây vàng |
| **07/09 chiều–tối** | Quay thật, dựng, viết post, **nộp** | Xong |
| **08/09** | Đệm · trả lời comment dưới post | An toàn |

Việc đầu tiên là Track B — nghe như ăn tiền lẻ, thực chất là bước **do thám**: tên tool, hình dạng payload, cách Binance trả lỗi. Thiếu mấy thứ đó thì hook viết mò.

---

## 11. Rủi ro

| Rủi ro | Xử lý |
|---|---|
| Tên/schema tool MCP khác dự đoán | Lấy dữ liệu thật ngay 04/09, viết fixture từ payload thật |
| Hook không đọc được payload MCP tool call | Hạ xuống Leash-MCP tự giác + đẩy proxy lên sớm. Phải biết chắc trước hết ngày 05/09 |
| Vốn nhỏ, khó tạo chuỗi lỗ thật để demo luật hành vi | Seed state file, khai báo minh bạch trong video |
| OAuth passthrough của proxy tắc | Đã có timebox + tiêu chí abort (§7) |
| Giám khảo nói "Binance đã có permission limits rồi" | Phản đòn nằm sẵn ở §5: limits của Binance là tĩnh, Leash là hành vi theo chuỗi lệnh và theo trạng thái lãi/lỗ |

---

## 12. Định nghĩa hoàn thành

- [ ] 8 luật có test, `npm test` xanh
- [ ] Hook chặn được lệnh thật trong Claude Code, kèm lý do người đọc hiểu được
- [ ] Ít nhất một lệnh **khớp thật** trên Agentic sub-account trong video
- [ ] Agent không lách được luật bằng prompt (đã thử ít nhất 3 kiểu lách)
- [ ] Handshake `check_order` -> lệnh thật hoạt động; lệnh không khai lý do bị chặn
- [ ] `audit.jsonl` + `leash report` chạy được
- [ ] Dashboard đổi ARMED → LOCKED khi kill-switch kích hoạt
- [ ] README có quickstart một lệnh
- [ ] Video ≤ 90 giây, đã nộp cả reply lẫn quote, đã điền survey

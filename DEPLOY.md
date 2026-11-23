# Triển khai PostgreSQL Railway và Cloudflare R2

## Trạng thái chuẩn bị

Backend hỗ trợ PostgreSQL/R2 và adapter Supabase tạm để khóa ghi trước cutover. Các lệnh data không tự thay production. Không push nhánh production trước khi biến môi trường tương thích đã được thiết lập: mặc định mới cần PostgreSQL/R2.

## 1. Tạo môi trường đích

- Backend production hiện tại ở US West, project `radiant-optimism` (đã xem dashboard ngày 23/11/2026). Tạo PostgreSQL cùng region và environment phù hợp. Khi thử nghiệm nên tách môi trường hoặc service; không đổi frontend production.
- Đã tạo service `Postgres` ngày 23/11/2026, image `postgres-ssl:18`, volume `postgres-volume`, US West; Serverless đang tắt. Chưa có phép đo chi phí PostgreSQL thật; ngân sách 8–10 USD/tháng trong kế hoạch là ước lượng, không phải giới hạn bảo đảm.
- PostgreSQL thực tế 18.6; memory limit đã đọc lại là 1 GB. CPU hiện kế thừa mức 8 của plan, chưa đặt được giới hạn 1 vCPU cho Postgres. Không có public DB endpoint. `showroom` dành cho final và còn trống; các database rehearsal/restore tách riêng. Role API `showroom_app` chỉ DML, pool tối đa 5.
- Dashboard tài khoản Hobby hiện yêu cầu **nâng Pro để tạo/schedule volume backup**. Chưa nâng gói. Vì vậy phải dùng job backup logic riêng vào kho riêng tư và diễn tập restore trước cutover; không coi volume hiện tại đã có backup tự động.
- Dùng URL nội bộ cho backend. Ưu tiên `railway connect Postgres --tunnel-only` để thao tác local qua tunnel mã hóa mà không bật public access. TCP proxy chỉ dùng khi có lý do và cấu hình TLS theo chứng chỉ thực tế. Không giảm kiểm tra chứng chỉ để vượt lỗi kết nối.
- Chạy `npm run db:migrate` bằng URL role quản trị/migration. Không dùng superuser cho API. Ví dụ cấp quyền sau khi DBA tạo role đăng nhập `showroom_app` bằng mật khẩu riêng trong hệ thống quản lý secret:

```sql
GRANT CONNECT ON DATABASE railway TO showroom_app;
GRANT USAGE ON SCHEMA public TO showroom_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.motorcycles, public.branches, public.admins TO showroom_app;
```

Tên database trong ví dụ phải đổi theo đích thật. Role không sở hữu bảng, không có quyền tạo role/database, không được cấp quyền lên `schema_migrations`. Không đưa `MIGRATION_DATABASE_URL` hay mật khẩu chủ database vào frontend.

## 2. Chuẩn bị R2

- Kích hoạt R2 nếu tài khoản chưa có; bước thanh toán/điều khoản thực hiện trên Cloudflare.
- Tạo bucket `motorcycle-images`, Standard. Tạo S3 token giới hạn đúng bucket với quyền đọc/ghi object. Đặt 5 biến `R2_*` trong `.env` local và Railway secrets. Không ghi khóa vào Git/log/chat.
- Cấu hình domain ảnh HTTPS công khai, ưu tiên domain riêng cho production. `r2.dev` chỉ dành cho diễn tập. Code không proxy lượt xem ảnh qua Railway.
- Chạy inventory, copy và rewrite theo README. Toàn bộ object phải đạt checksum/HTTP public, manifest không được còn ảnh thiếu.
- Khi R2 chưa sẵn sàng, PostgreSQL vẫn thử được với `STORAGE_PROVIDER=supabase`; đây chưa phải bước kết thúc Supabase.
- Ngày 23/11/2026: bucket Standard/APAC và token đọc/ghi giới hạn `motorcycle-images` đã tạo; domain `images.xedien3sgo.com` Active/Enabled, minimum TLS 1.2, `r2.dev` tắt. Nameserver là `bethany.ns.cloudflare.com`/`nile.ns.cloudflare.com`; apex và `www` giữ DNS only để định tuyến Vercel như trước. Website và ảnh thử đã trả HTTP 200 sau chuyển DNS.

## 3. Diễn tập trên bản sao

1. Export nguồn ra file mới. Đối chiếu schema live SQL (cột, constraint, trigger, extension, phiên bản) với `db/migrations/001_initial.sql`; kiểm tra REST export ba bảng không thay thế kiểm tra schema đầy đủ.
2. Copy ảnh, rewrite snapshot nếu dùng R2. Import snapshot vào database đích trống, chạy `data verify` và API tests. Không nhập bản rehearsal vào database sẽ nhận final nếu chưa chuẩn bị database trống riêng.
3. Export PostgreSQL, restore vào database mới, verify. Kiểm tra JWT cũ, đăng nhập, giá, lọc chi nhánh, upload và lỗi SQL. Kiểm tra khôi phục native `pg_dump/pg_restore` nếu dùng làm backup vận hành.
4. Cấu hình `DATABASE_PROVIDER=postgres`, `DATABASE_URL`, `DATABASE_SSL`, `DATABASE_POOL_MAX=5`, `STORAGE_PROVIDER`, `JWT_SECRET` cũ, `FRONTEND_URL`. `/api/ready` là healthcheck deploy.
5. Theo dõi tải đại diện, RAM, disk, reconnect và no-sleep trước khi cutover. Integration local chỉ xác minh hành vi; không thay cho 48–72 giờ đo hosting.

Đã đọc catalog nguồn qua SQL Editor ngày 23/11/2026 và đối chiếu tự động với đích: 17 cột, 6 constraint và trigger `set_updated_at` khớp định nghĩa. Nguồn PostgreSQL 17.6, đích 18.6. Khác biệt chủ động: tên foreign key; hai index phục vụ danh mục ở đích; schema/role/extension riêng của Supabase không chuyển. Bằng chứng riêng tư: `backups/source-schema-audit-2026-11-23.json`.

Đã thử adapter Supabase qua HTTP local với dữ liệu live (148 xe tại thời điểm kiểm tra): danh mục khớp API production, cùng JWT được cả backend cũ và mới chấp nhận, readiness đạt; maintenance trả 503 trước khi đọc upload và vẫn cho phép xử lý login. Không ghi vào nguồn trong bài kiểm tra. Người vận hành xác nhận chỉ trang quản trị website là nguồn chỉnh sửa; cần bảo đảm điều này vẫn đúng lúc bật maintenance. Bằng chứng: `backups/supabase-bridge-verification-2026-11-23.json`.

Đã chép và xác minh SHA-256/byte/MIME cho 3.124 object (876.669.980 byte), sau đó tải và đối chiếu toàn bộ qua `images.xedien3sgo.com`. API diễn tập trong container Railway, qua mạng private tới `showroom_r2_rehearsal`, đạt đăng nhập/JWT, CRUD, upload và tải ảnh R2, maintenance, branch join, giá và thứ tự ảnh. 20 lượt đọc đồng thời dùng pool 5 đạt p50 308 ms, p95 369 ms. Bài tải tương tự qua SSH tunnel từ máy vận hành bị timeout; không tăng timeout production để che độ trễ đường hầm. Bằng chứng: `backups/r2-public-verified-2026-11-23.json`, `backups/railway-r2-api-verification-2026-11-23.json`.

Quan sát 61 mẫu trong một giờ chuẩn bị: PostgreSQL dùng tối đa khoảng 116 MB RAM và 0,0046 CPU; RAM limit 1 GB, CPU limit vẫn 8. Đây là tải chuẩn bị/diễn tập, chưa phải phép đo chi phí hay độ ổn định dài ngày của production.

## 4. Khóa ghi nguồn và chuyển chính thức

1. Trước khi deploy code mới vào backend hiện tại, đặt rõ `DATABASE_PROVIDER=supabase`, `STORAGE_PROVIDER=supabase`, giữ nguyên Supabase keys và `JWT_SECRET`. Deploy release chuẩn bị: toàn bộ dữ liệu vẫn ở nguồn, nhưng có cơ chế maintenance.
2. Bật `WRITE_MAINTENANCE=true`, deploy và đợi deployment cũ đã dừng. GET và login vẫn phục vụ, CRUD/upload trả 503. Dừng cả script ghi bên ngoài/API trực tiếp Supabase; maintenance Express không khóa dashboard hoặc service-role ngoài app.
3. Chờ request ghi cũ kết thúc, export final bằng `data export-supabase ... --source-frozen` hoặc snapshot SQL nhất quán. Giữ dump/schema và release cũ. Không dùng snapshot rehearsal trong ngày trước làm final.
4. Copy phần ảnh phát sinh vào R2, xác minh, rewrite final snapshot. Import vào database đích **trống**, chạy verify. Nếu muốn đổi DB trước, dùng snapshot nguyên URL Supabase và giữ provider ảnh Supabase.
5. Đổi `DATABASE_PROVIDER=postgres` và các biến kết nối đích; đổi storage khi R2 đã đạt. Vẫn giữ `WRITE_MAINTENANCE=true`; deploy, xác minh `/api/ready`, danh mục/giá/ảnh/admin từ URL production.
6. Chỉ mở ghi khi kiểm tra đạt. Mỗi thời điểm chỉ một DB nhận ghi production. Chạy một thao tác thử có nhận diện và kiểm tra trạng thái lưu thực tế.

Giữ nguyên URL API thì frontend không cần build lại. Khi một trong DB/storage config thiếu, server từ chối khởi động thay vì tự chuyển nhầm nguồn. Giữ Supabase 7–14 ngày sau cutover để có bản gốc và đường quay lại.

## 5. Quay lại và backup

- **Chưa mở ghi đích:** giữ maintenance, trả `DATABASE_PROVIDER=supabase`/storage cũ hoặc deploy release cũ, kiểm tra rồi mở ghi. Nguồn vẫn còn trạng thái final.
- **Đã mở ghi đích:** không chỉ đổi provider. Khóa cả hai nguồn ghi, export trạng thái PostgreSQL mới và backup đích quay lại. `node scripts/rollback.js backups/destination-before.json backups/postgres-current.json` chỉ kiểm tra file; muốn áp dụng phải đặt rõ `ROLLBACK_DATABASE_URL` và thêm `--apply --writes-frozen`. Lệnh khóa ba bảng, đối chiếu nguyên trạng với backup trước khi thay đổi, từ chối foreign key ngoài ba bảng/trigger insert-delete chưa xem xét, rồi thay dữ liệu và đối chiếu tất cả trường trong một transaction. Đã kiểm thử thêm/sửa/xóa, quan hệ, microsecond, hash và URL ảnh R2, cũng như hủy toàn bộ khi dữ liệu sai hoặc backup đích đã cũ. Cần kết nối SQL quản trị tới đích quay lại; không dùng REST để ghi đè từng bảng. Chưa chạy thao tác này lên Supabase thật.
- Khi quay lại database, giữ R2 hoạt động và các URL R2 hiện có; đồng bộ dữ liệu không tự chép byte ảnh về Supabase. Nếu R2 cũng gặp sự cố thì phải có kế hoạch phục hồi ảnh riêng trước khi mở ghi. Nếu PostgreSQL mất kết nối, ghi rõ thời điểm backup được phục hồi và phần dữ liệu có thể mất.
- `data export-postgres` tạo backup logic ba bảng, cần lưu cùng migrations và cấu hình. Native `pg_dump --format=custom --no-owner --no-acl` cùng `pg_restore` vẫn cần thiết cho vận hành DB đầy đủ; dùng biến môi trường/pgpass để không lộ password trong command line, và giữ backup ở kho riêng tư.
- Đã cấu hình service `postgres-backup` trên Railway, lịch `0 19 * * *` UTC = 02:00 Việt Nam, restart NEVER, 1 GB RAM/1 vCPU. Job dùng `showroom_backup` chỉ SELECT, native dump PostgreSQL 18 và AES-256-GCM, lưu vào bucket riêng tư `3sgo-database-backups`. Token chỉ được đọc/ghi bucket backup; khóa mã hóa nằm trong secrets, không nằm trong object R2.
- Lần chạy thủ công 23/11/2026 đã kết thúc và xác minh đọc lại archive. Đã tải archive rehearsal từ R2, giải mã, restore vào `showroom_r2_restore_20261123`, đối chiếu đủ 142 xe/4 chi nhánh/1 admin/961 tham chiếu ảnh. Bằng chứng: `backups/railway-backup-job-verification-2026-11-23.json` và `backups/railway-r2-restore-verification-2026-11-23.json`. Chưa quan sát lần chạy tự động đầu tiên. `showroom` còn trống: job hiện chưa bảo vệ dữ liệu live Supabase.
- Kiểm tra vận hành: `railway logs --service postgres-backup --lines 30 --json` phải có `verified: true`; đối chiếu timestamp/object tương ứng trong R2 sau 02:00 mỗi ngày. Nếu quá 26 giờ không có archive xác minh hoặc job lỗi, xử lý trước khi coi backup còn cập nhật. Chưa cấu hình gửi cảnh báo tự động ra ngoài; kiểm tra log thủ công không thay thế cảnh báo.
- Giữ toàn bộ archive trong giai đoạn chuyển đổi; chưa bật retention tự xóa. Sau vận hành ổn định cần thống nhất thời gian giữ và thử phục hồi định kỳ trước khi dọn. Code giới hạn archive 128 MiB, cần streaming khi dữ liệu vượt ngưỡng. Ảnh bỏ khỏi xe được giữ trong rollback window; chỉ dọn sau khi kiểm tra không còn tham chiếu.

## 6. Cấu hình Railway trong repository

`.railway/railway.ts` là partial chỉ quản lý backend `glorious-youthfulness`, variables unmanaged. Đã chạy plan thành công; chưa apply và chưa thay `railway.json` đang dùng production. Chỉ chuyển cấu hình healthcheck sang `/api/ready` khi release tương thích đã được chuẩn bị. Không áp healthcheck mới vào backend cũ. Không đưa `.local/`, `backups/`, `.env` hoặc file variables có secrets vào gói deploy.

Tài liệu chính thức: [Railway PostgreSQL](https://docs.railway.com/databases/postgresql), [node-postgres TLS](https://node-postgres.com/features/ssl), [Cloudflare R2 SDK](https://developers.cloudflare.com/r2/examples/aws/aws-sdk-js-v3/).

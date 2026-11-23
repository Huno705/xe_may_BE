# 3sGo backend — PostgreSQL + R2

Express 5 / Node.js 22+, PostgreSQL qua `pg`, bcrypt/JWT và ảnh trên Cloudflare R2. Frontend tiếp tục dùng các API và cấu trúc JSON cũ. Không lưu byte ảnh trong database.

## Chạy local

```sh
npm ci
# Sao chép .env.example thành .env rồi điền cấu hình thật.
# DATABASE_URL trỏ tới database PostgreSQL riêng đã tạo trước.
npm run db:migrate
# Đặt ADMIN_PASSWORD trong môi trường, tránh ghi mật khẩu trong lịch sử shell.
npm run create-admin -- admin@example.com
npm run dev
```

Migration yêu cầu PostgreSQL 13+ (`gen_random_uuid`); đã kiểm thử trên PostgreSQL 18.0. Database đích phải riêng cho ứng dụng. Không chạy migration lên Supabase nguồn. Chạy migration có phiên bản bằng lệnh riêng, không tự chạy mỗi lần server khởi động. Lệnh giữ advisory lock và từ chối migration đã bị sửa sau khi áp dụng.

`DATABASE_SSL=verify-full` là mặc định trong code. `.env.example` dùng `disable` cho localhost; chỉ dùng `disable` khi endpoint riêng thực tế yêu cầu. Endpoint công khai phải xác minh chứng chỉ; có thể đặt `DATABASE_SSL_CA_FILE`. Không dùng `rejectUnauthorized=false`; URL không được chứa tùy chọn TLS mâu thuẫn.

Pool mặc định tối đa 5 kết nối, timeout kết nối 5 giây, timeout SQL 15 giây. Giữ nguyên `JWT_SECRET` production khi chuyển. Runtime dùng role giới hạn quyền; `MIGRATION_DATABASE_URL` dành cho các lệnh quản trị và không cần đưa vào môi trường chạy API.

## API

| Method | Endpoint | Quyền | Kết quả |
| --- | --- | --- | --- |
| GET | `/api/health` | Công khai | Tiến trình còn chạy, không truy vấn DB |
| GET | `/api/ready` | Công khai | DB truy cập được; 503 khi không sẵn sàng |
| POST | `/api/auth/login` | Công khai | `{token, admin: {id, email}}` |
| GET | `/api/auth/verify` | Bearer JWT | Xác minh JWT |
| GET | `/api/motorcycles?branch_id=<uuid>` | Công khai | Danh sách; `branches: {name}` hoặc `null` |
| GET | `/api/motorcycles/:id` | Công khai | Chi tiết, 404 nếu không có |
| POST / PUT / DELETE | `/api/motorcycles[/:id]` | Admin | CRUD xe |
| GET | `/api/branches`, `/api/motorcycles/branches` | Công khai | Danh sách chi nhánh |
| POST / PUT / DELETE | `/api/branches[/:id]` | Admin | CRUD chi nhánh |

Tạo/sửa xe dùng multipart với `name`, `price`, `description`, `saigon_deposit`, `province_deposit`, `branch_id`, file `images`. Khi sửa, `existingImages` là JSON array URL hiện có muốn giữ; bỏ trường này sẽ giữ toàn bộ ảnh cũ. `[]` bỏ toàn bộ ảnh cũ khỏi xe. Tối đa 10 file mới/request, 5 MB/file, JPEG/PNG/GIF/WebP/AVIF. Kiểm tra chữ ký file và MIME trước upload. Giá mới phải không âm, tối đa hai chữ số thập phân.

Upload dùng key UUID mới. SQL thất bại thì thử dọn các upload vừa tạo, chỉ khi truy vấn xác nhận không có tham chiếu. Nếu DB mất kết nối hoặc kết quả commit chưa rõ, giữ ảnh và ghi `Image cleanup deferred` để xử lý sau. Xóa xe/bỏ ảnh **giữ file cũ** trong giai đoạn chuyển và quay lại; chưa bật dọn ảnh mồ côi tự động.

## Chuyển dữ liệu

```sh
# Đọc nguồn; tạo file mới, không ghi đè backup có sẵn.
npm run data -- export-supabase backups/source-rehearsal.json
npm run data -- import backups/source-rehearsal.json
npm run db:migrate
npm run data -- import backups/source-rehearsal.json --apply
npm run data -- verify backups/source-rehearsal.json

# Backup/restore logic ba bảng, kèm checksum và đối soát từng trường.
npm run data -- export-postgres backups/postgres-snapshot.json
```

Import chỉ nhận **ba bảng đích trống**, trong một transaction; giữ UUID, hash mật khẩu, timestamp đến microsecond, thứ tự ảnh, giá và quan hệ chi nhánh. Từ chối schema khác file hiện có, snapshot bị sửa checksum, dữ liệu đích không trống hoặc đối chiếu sai. Để restore, dùng database mới, chạy migration, import rồi verify. Công cụ operator riêng `scripts/rollback.js` phục vụ đồng bộ ngược có điều kiện sau cutover; đọc quy trình khóa ghi/backup/đối chiếu đích trong `DEPLOY.md` trước khi sử dụng.

Export Supabase dùng service API, đọc có phân trang hai lượt và so checksum. Đây là phương án diễn tập khi chưa có mật khẩu PostgreSQL nguồn; **không thay thế snapshot transaction/pg_dump** khi nguồn vẫn ghi. Trước bản export cuối phải khóa toàn bộ nguồn ghi; cờ `--source-frozen` chỉ ghi nhận xác nhận của người vận hành, không tự khóa Supabase. Dùng `pg_dump` cùng kiểm kê schema live trước cutover nếu có kết nối SQL nguồn.

`backups/`, `.local/`, `.env*` thật và dump bị loại khỏi Git. Snapshot có hash mật khẩu admin: lưu riêng tư, mã hóa bản sao ngoài máy và không đính kèm vào báo cáo công khai.

## Chuyển ảnh

```sh
# Chỉ thống kê, không cần cấu hình R2 và không upload.
npm run images -- copy backups/source-rehearsal.json backups/inventory.json
# Có đầy đủ R2_*; output manifest phải là file mới.
npm run images -- copy backups/source-rehearsal.json backups/verified-images.json --apply
# Nếu domain chưa sẵn sàng: chép riêng tư trước, rồi kiểm tra public sau.
npm run images -- stage backups/source-rehearsal.json backups/private-images.json --apply
npm run images -- verify-public backups/source-rehearsal.json backups/private-images.json backups/verified-images.json
# Tạo snapshot mới chứa URL R2; không sửa snapshot nguồn hay DB.
npm run images -- rewrite backups/source-rehearsal.json backups/verified-images.json backups/with-r2.json
```

Copy duyệt tất cả object, kể cả thư mục và file không còn được xe tham chiếu. Giữ key/MIME; so byte và SHA-256 qua S3 và URL công khai. Không dùng ETag làm checksum. Chạy lại có thể tiếp tục nếu các object đã chép khớp nội dung; từ chối ghi đè key có nội dung khác. Manifest chỉ được đánh dấu verified khi tất cả bước đạt. Rewrite chỉ nhận manifest khớp snapshot, thay URL thuộc đúng origin/bucket nguồn, giữ URL bên ngoài và thứ tự ảnh. URL nguồn có query/fragment bị từ chối để kiểm tra riêng.

`stage` chỉ xác minh S3 và tạo manifest `verified=false`. Chỉ `verify-public` thành công cho toàn bộ object mới cho phép rewrite. Manifest được ghi ở cuối; mất tiến trình thì chạy lại sẽ kiểm tra lại file đã có. Hai cách `copy` trực tiếp và `stage`/`verify-public` là các lựa chọn thay thế, không chạy đồng thời vào cùng output.

Đặt `STORAGE_PROVIDER=supabase` để chuyển DB trước khi R2 sẵn sàng. Chế độ này vẫn phụ thuộc Supabase Storage và **chưa loại bỏ được phí Supabase**. Mặc định storage là R2 và database là PostgreSQL; không tự fallback khi cấu hình thiếu/lỗi.

## Backup PostgreSQL mã hóa

Job dùng `Dockerfile.backup`, PostgreSQL client 18, role `showroom_backup` chỉ SELECT, và bucket R2 riêng tư `3sgo-database-backups`. Cấu hình `BACKUP_DATABASE_URL`, `BACKUP_ENDPOINT`, `BACKUP_BUCKET`, `BACKUP_ACCESS_KEY_ID`, `BACKUP_SECRET_ACCESS_KEY`, `BACKUP_ENCRYPTION_KEY` trong secrets của job. Khóa mã hóa là 32 byte ngẫu nhiên dạng base64; giữ bản phục hồi khóa ở nơi riêng với R2 và không đưa vào Git.

```sh
npm run backup -- create
# RESTORE_DATABASE_URL phải trỏ tới một database mới, trống.
npm run backup -- restore postgres/<timestamp>-<uuid>.dump.enc
```

Archive native được mã hóa AES-256-GCM trước upload; job tải lại object, kiểm tra byte và giải mã trước khi báo thành công. Restore xác thực mã hóa rồi chạy `pg_restore` trong transaction, từ chối database đã có bảng. Sau restore phải đối chiếu dữ liệu trước khi dùng. Bộ nhớ hiện giới hạn dump 128 MiB; vượt ngưỡng sẽ báo lỗi và cần chuyển sang giải pháp streaming.

Service Railway `postgres-backup` đã cấu hình `0 19 * * *` UTC (02:00 Việt Nam), restart NEVER, không HTTP healthcheck. Ngày 23/11/2026 đã chạy thủ công thành công và khôi phục archive diễn tập từ R2, khớp 142 xe/4 chi nhánh/1 admin. Job trỏ tới `showroom`; database này còn trống trước cutover nên **chưa sao lưu dữ liệu Supabase đang chạy**. Chưa có chính sách tự xóa backup hoặc cảnh báo gửi ra ngoài. Xem hướng dẫn vận hành trong DEPLOY.md.

## Kiểm thử

```sh
npm test
npm run test:integration
```

Lệnh integration tạo cluster PostgreSQL mới dưới `.local`, chỉ bind localhost, dùng mật khẩu ngẫu nhiên, tự dừng và dọn sau test. Không chạm các database đã cài trên máy. Windows mặc định tìm `C:/Program Files/PostgreSQL/18/bin`; đặt `PG_BIN` khi dùng vị trí khác. Linux cần `initdb`, `pg_ctl` trên PATH và chạy bằng user không phải root. Đặt `REHEARSAL_SNAPSHOT` để kiểm tra thêm bản sao thật. Integration kiểm tra API qua HTTP, transaction rollback, backup/restore, pool reconnect, maintenance và tải đọc đồng thời. R2 thật cần kiểm tra riêng bằng `images copy --apply` sau khi có bucket/credentials/domain.

Chi tiết chuyển Railway và phương án quay lại: [DEPLOY.md](DEPLOY.md). Checklist: [DEPLOY_CHECKLIST.md](DEPLOY_CHECKLIST.md).

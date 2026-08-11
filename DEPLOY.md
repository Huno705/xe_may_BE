# Hướng dẫn Deploy Backend lên Railway

## Bước 1: Đẩy code lên GitHub

1. Tạo repo mới trên GitHub (ví dụ: `showroom-xe-backend`)
2. Từ thư mục `backend/`, chạy:
```bash
git init
git add .
git commit -m "Initial backend setup"
git branch -M main
git remote add origin https://github.com/<username>/<repo-name>.git
git push -u origin main
```

**Lưu ý:** File `.env` đã được `.gitignore` bỏ qua, không bao giờ commit lên GitHub.

## Bước 2: Tạo project trên Railway

1. Truy cập [railway.app](https://railway.app) → đăng nhập bằng GitHub
2. Click **"New Project"** → chọn **"Deploy from GitHub repo"**
3. Chọn repo `showroom-xe-backend` vừa tạo
4. Railway tự detect Node.js và bắt đầu build

## Bước 3: Thêm biến môi trường (Environment Variables)

Vào project → tab **Variables** → thêm từng biến sau:

### Biến bắt buộc:

```
SUPABASE_URL=https://<project-id>.supabase.co
SUPABASE_SERVICE_KEY=<service_role_key từ Supabase Dashboard>
JWT_SECRET=<chuỗi ngẫu nhiên 64+ ký tự>
FRONTEND_URL=https://<domain-frontend>.vercel.app
```

**Cách lấy Supabase keys:**
- Vào [Supabase Dashboard](https://supabase.com/dashboard)
- Chọn project → Settings → API
- Copy `URL` và `service_role` key (không phải `anon` key!)

**Tạo JWT_SECRET:**
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

**FRONTEND_URL:** 
- Trong quá trình test, dùng `*` (cho phép mọi origin)
- Sau khi deploy frontend, thay bằng domain thật (ví dụ: `https://showroom-xe.vercel.app`)

### Biến tùy chọn:

```
PORT=5000
```
(Railway tự gán `PORT`, không cần set thủ công)

## Bước 4: Deploy và lấy URL backend

1. Railway tự động deploy sau khi thêm biến môi trường
2. Vào tab **Settings** → **Networking** → click **Generate Domain**
3. Copy URL (ví dụ: `https://showroom-xe-backend-production.up.railway.app`)

## Bước 5: Tạo tài khoản admin đầu tiên

Railway không có terminal trực tiếp. Có 2 cách:

### Cách 1: Dùng Railway CLI (khuyến nghị)
```bash
# Cài Railway CLI
npm i -g @railway/cli

# Đăng nhập
railway login

# Link project
railway link

# Chạy script tạo admin
railway run npm run create-admin
```

### Cách 2: Tạo admin local rồi import vào Supabase
```bash
# Chạy local với .env trỏ đến Supabase production
npm run create-admin
```
Script sẽ tạo admin trực tiếp vào database Supabase production.

## Bước 6: Kiểm tra backend hoạt động

Mở trình duyệt hoặc dùng curl:
```bash
curl https://<railway-url>/api/health
```
Kết quả mong đợi: `{"status":"ok"}`

## Bước 7: Cập nhật frontend

Trong project frontend, tạo file `.env.production`:
```
VITE_API_URL=https://<railway-url>
```

Rồi deploy frontend lên Vercel/Netlify.

## Bước 8: Khóa CORS (sau khi có domain frontend)

Quay lại Railway → **Variables** → sửa:
```
FRONTEND_URL=https://showroom-xe.vercel.app
```

Railway tự redeploy. Từ giờ chỉ frontend của bạn mới gọi được API.

---

## Giám sát tài nguyên

- Vào **Metrics** tab để xem RAM/CPU usage
- Free tier ($1/tháng) chỉ đủ chạy ~15–20 ngày, sau đó cần nâng lên **Hobby ($5/tháng)**
- Nếu muốn tiết kiệm, xem xét dùng **Render free tier** (ngủ sau 15 phút không dùng)

## Troubleshooting

**Lỗi "Cannot connect to Supabase":**
- Kiểm tra `SUPABASE_URL` và `SUPABASE_SERVICE_KEY` đã đúng chưa
- Đảm bảo dùng `service_role` key, không phải `anon` key

**Lỗi CORS:**
- Set `FRONTEND_URL=*` để test
- Sau khi chắc frontend gọi được, mới khóa lại domain cụ thể

**App crash liên tục:**
- Xem logs tại tab **Deployments** → click deployment gần nhất → **View Logs**
- Thường do thiếu biến môi trường

## Quản lý chi phí

Railway tính theo usage:
- **RAM:** ~$0.000004/GB/giây (~$1.5/tháng với 150MB)
- **CPU:** chỉ tính khi xử lý request
- **Egress:** băng thông ra (ảnh ở Supabase nên rất ít)

Check usage tại tab **Usage** để tránh vượt credit.

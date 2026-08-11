# ✅ Checklist Deploy Backend → Railway

## Chuẩn bị trước khi deploy

- [ ] Code backend đã push lên GitHub
- [ ] File `.env` **KHÔNG** bị commit (đã có trong `.gitignore`)
- [ ] Có sẵn Supabase project với:
  - [ ] Table `motorcycles` đã tạo (storage: `images`, bucket: `motorcycles`)
  - [ ] Đã copy `SUPABASE_URL` và `service_role` key

## Deploy trên Railway

- [ ] Tạo project mới từ GitHub repo
- [ ] Thêm 3 biến môi trường bắt buộc:
  ```
  SUPABASE_URL=https://xxxxxxx.supabase.co
  SUPABASE_SERVICE_KEY=eyJhbG...
  JWT_SECRET=<chạy: node -e "console.log(require('crypto').randomBytes(48).toString('hex'))">
  ```
- [ ] (Tùy chọn) Thêm `FRONTEND_URL=*` để test, sau đổi thành domain frontend thật
- [ ] Generate domain tại **Settings → Networking**
- [ ] Test health endpoint: `curl https://<railway-url>/api/health`

## Tạo tài khoản admin

### Cách 1: Railway CLI (khuyến nghị)
```bash
npm i -g @railway/cli
railway login
railway link
railway run npm run create-admin
```

### Cách 2: Chạy local trỏ về Supabase production
```bash
cd backend
# Đảm bảo .env có SUPABASE_URL và SERVICE_KEY production
npm run create-admin
```

## Kết nối frontend

- [ ] Tạo file `frontend/.env.production`:
  ```
  VITE_API_URL=https://<railway-url>/api
  ```
- [ ] Deploy frontend (Vercel/Netlify)
- [ ] Quay lại Railway, đổi `FRONTEND_URL` thành domain frontend thật
- [ ] Test đăng nhập + thêm xe

---

**Giám sát:** Vào Railway **Metrics** để xem RAM usage. Free tier $1/tháng chỉ đủ ~15 ngày, sau đó nâng lên Hobby $5/tháng.

Chi tiết đầy đủ: xem [DEPLOY.md](./DEPLOY.md)

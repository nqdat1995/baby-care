# Bé Yêu — Tã & Sữa 🍼

PWA (Progressive Web App) giúp cha mẹ theo dõi việc **thay tã** và **cữ bú** của em bé. Hoạt động **ngoại tuyến** (offline-first), cài được như app gốc trên điện thoại, deploy tĩnh lên **GitHub Pages** — không cần backend.

## Tính năng (MVP)

- 🧷 **Ghi tã**: ướt / bẩn / cả hai, thời điểm, ghi chú; sửa & xóa
- 🍼 **Ghi cữ bú**: bú mẹ (bên trái/phải + thời lượng), bú bình (sữa mẹ vắt / công thức + ml); sửa & xóa
- 📊 **Thống kê hôm nay**: tổng tã, tã ướt, tã bẩn, số cữ bú, tổng ml bình
- 📜 **Lịch sử theo ngày** với bộ lọc Tất cả / Tã / Bú
- 💾 **Lưu cục bộ IndexedDB** — không gửi dữ liệu lên máy chủ nào
- ⬇️⬆️ **Xuất / nhập bản sao lưu JSON** (ghép hoặc thay thế, kiểm tra toàn bộ tệp trước khi ghi)
- 📲 **PWA**: manifest + service worker, cài đặt offline, có cập nhật phiên bản mới

## Công nghệ

Vanilla JS (ES modules), HTML semantic, CSS responsive, IndexedDB. Không framework, không build step —_deploy thẳng thư mục tĩnh.

```
index.html            app shell + dialogs
styles.css            mobile-first UI
manifest.webmanifest  PWA manifest (đường dẫn tương đối — hợp base path repo)
sw.js                 service worker (precache app shell, cache-first)
js/domain.js          validation + stats (pure function, có unit test)
js/storage.js         IndexedDB repository (tách lớp, có integration test)
js/app.js             UI glue
test/                 node:test — unit + integration (fake-indexeddb)
tools/check.js        QC static consistency check
```

## Phát triển

```bash
npm test              # unit + integration tests
node tools/check.js   # QC: ID/asset/manifest consistency
npm run serve         # serve local (PWA cần HTTPS hoặc localhost)
```

## Deploy lên GitHub Pages

1. Tạo repository GitHub mới (vd: `baby-care`), rồi:
   ```bash
   git remote add origin https://github.com/<user>/<repo>.git
   git push -u origin main
   ```
2. Repo → **Settings → Pages → Source: GitHub Actions**.
3. Push vào `main` → workflow `deploy.yml` tự chạy test rồi deploy.
4. App chạy tại `https://<user>.github.io/<repo>/`.

> Mọi đường dẫn đều tương đối (`./`) nên app hoạt động đúng dưới sub-path của GitHub Pages.

## Lưu ý dữ liệu

Dữ liệu chỉ lưu trong IndexedDB trên thiết bị hiện tại. **Xóa dữ liệu trình duyệt = mất dữ liệu.** Hãy xuất bản sao lưu JSON định kỳ (Cài đặt → Xuất bản sao lưu).

## Roadmap (sau MVP)

Nhiều hồ sơ bé · biểu đồ xu hướng tuần/tháng · nhắc lịch (Notifications API) · xuất CSV · đồng bộ đa thiết bị (cần backend).

# Zi Mo Mahjong — Website, Booking, POS & Hitung Poin

Isi proyek:

| Halaman | Alamat | Untuk |
|---|---|---|
| Beranda | `/` | Info, harga, lokasi |
| Booking meja | `/booking` | Pelanggan pilih tanggal, meja, jam, lalu bayar |
| Cek booking | `/cek` | Pelanggan cek status & ganti jadwal (paling lambat H-1) |
| Hitung poin | `/skor` | Room skor mahjong 4 pemain, sinkron antar-HP |
| Dashboard staf | `/admin/` | Kasir & meja (timer), booking, transaksi, laporan, menu, pengguna, pengaturan, log |

Teknologinya: **Cloudflare Workers** (website + API dalam satu project, kode API di folder `src/`, file website di `public/`)
+ **D1** (database SQLite). Semuanya muat di paket gratis Cloudflare untuk 2–3 meja. GitHub dipakai untuk menyimpan kode;
Cloudflare otomatis deploy ulang setiap kali kamu push.

> GitHub Pages saja **tidak bisa** dipakai, karena hanya menyajikan file statis tanpa database.

---

## Deploy pertama kali (±20 menit)

### 1. Buat database D1 dulu
1. dash.cloudflare.com → **Storage & Databases → D1 SQL Database → Create Database**.
2. Nama: `zimo-db` → **Create**.
3. Salin **Database ID** (deretan huruf-angka panjang, contoh `3f2a9c1e-....`).

Tabel dibuat otomatis saat website pertama kali dibuka, jadi tidak perlu menjalankan SQL apa pun.

### 2. Upload ke GitHub
1. Buka file `wrangler.toml` di folder ini, ganti `GANTI-DENGAN-DATABASE-ID` dengan ID dari langkah 1, simpan.
2. Buat repository baru di github.com, misalnya `zimo-mahjong` (boleh **Private**).
3. Upload seluruh isi folder ini (kecuali `node_modules` dan `.wrangler` kalau ada):
   di halaman repo klik **Add file → Upload files**, drag semua file & folder, lalu **Commit changes**.
   Pastikan `wrangler.toml`, folder `src`, dan folder `public` ada di halaman utama repo, bukan di dalam subfolder lain.

### 3. Buat Worker dari GitHub
1. dash.cloudflare.com → **Workers & Pages → Create application** (tab **Workers**) → **Import a repository**.
2. Hubungkan akun GitHub kalau diminta, lalu pilih repo `zimo-mahjong`.
3. Isi pengaturan:
   - Project name: `zimo-mahjong` (harus sama dengan `name` di `wrangler.toml`)
   - Build command: *(kosongkan)*
   - Deploy command: `npx wrangler deploy` (biasanya sudah terisi otomatis)
   - Root directory / path: *(kosongkan atau `/`)*
4. Klik **Create and deploy** / **Deploy**. Tunggu sampai muncul alamat `https://zimo-mahjong.<akunmu>.workers.dev`.
5. Cek **Settings → Bindings**: harus ada **D1 database** `DB` → `zimo-db`. Ini diambil otomatis dari `wrangler.toml`.

Kalau deploy gagal, buka **Deployments → View build log**. Penyebab yang paling sering:
- `database_id` di `wrangler.toml` masih `GANTI-DENGAN-DATABASE-ID` atau salah salin.
- Project name berbeda dengan `name` di `wrangler.toml`.
- File ada di dalam subfolder repo (misalnya `zimo-website/wrangler.toml`). Pindahkan ke halaman utama repo,
  atau isi Root directory dengan nama subfolder tersebut.

### 4. Pasang kode setup (penting)
Supaya orang lain tidak bisa membuat akun pemilik duluan:
1. Worker `zimo-mahjong` → **Settings → Variables and Secrets → Add**.
2. Type **Secret**, nama `SETUP_KEY`, isi dengan kode rahasia buatanmu (misal `zimo-rahasia-2026`) → **Deploy**.

### 5. Buat akun Superadmin
1. Buka `https://zimo-mahjong.<akunmu>.workers.dev/admin/`.
2. Isi nama, username, password, dan kode setup → **Buat akun Superadmin**.
3. Setelah akun pertama ada, form setup otomatis tertutup selamanya.

### 6. Sambungkan domain
1. Pastikan domain sudah memakai nameserver Cloudflare (di DomaiNesia: ganti nameserver ke yang diberikan Cloudflare,
   lalu tunggu status domain di Cloudflare jadi **Active**).
2. Worker `zimo-mahjong` → **Settings → Domains & Routes → Add → Custom domain** → ketik domainmu → **Add domain**.
   Ulangi untuk `www.domainmu` kalau mau.
3. Cloudflare membuat DNS & HTTPS sendiri dalam beberapa menit.

---

## Setelah online: yang perlu diisi di **Pengaturan**
- Nomor WhatsApp (format `62812…`), Instagram, alamat, link Google Maps
- **Instruksi pembayaran**: nomor rekening / info QRIS yang muncul setelah pelanggan booking
- Harga per jam (sekarang Rp50.000), paket jam (isi harga 0 kalau tidak ada paket), toleransi menit
- Nama meja (bisa tambah/nonaktifkan meja)
- Menu F&B di menu **Menu F&B** (data awal hanya contoh)

## Role
| | Superadmin | Admin | Kasir |
|---|:-:|:-:|:-:|
| Kasir & meja, jual F&B | ✓ | ✓ | ✓ |
| Booking: tambah, konfirmasi bayar, ganti jadwal | ✓ | ✓ | ✓ |
| Batalkan booking / sesi, beri diskon | ✓ | ✓ | – |
| Laporan lengkap + unduh CSV | ✓ | ✓ | hanya shift sendiri |
| Menu F&B | ✓ | ✓ | – |
| Void transaksi | ✓ | – | – |
| Pengguna, pengaturan, log aktivitas | ✓ | – | – |

**Void**: transaksi yang di-void keluar dari pendapatan, tapi datanya tetap tersimpan lengkap dengan siapa, kapan, dan alasannya,
lalu muncul di Log aktivitas. Laporan juga menampilkan jumlah transaksi yang di-void.

## Aturan bisnis yang sudah dipasang
- Meja ditagih per jam penuh (setelah toleransi menit), minimal 1 jam.
- Booking online berstatus *Menunggu bayar* dan ditahan selama "Batas waktu bayar". Kalau tidak dikonfirmasi admin, slot dilepas otomatis.
- Pelanggan bisa ganti jadwal sendiri sampai H-1 lewat `/cek`. Tidak ada tombol batal/refund untuk pelanggan.
- Booking yang sudah lunas lalu main lebih lama: kasir hanya menagih **selisih jamnya**.
- Hitung poin: nilai menang = dasar + tai × poin per tai. Zimo dibayar 3 pemain, tembak dibayar pemain yang membuang ubin.
  Semua angka bisa diatur per room.

## Coba di komputer sendiri (opsional)
```bash
npm install
npx wrangler dev        # buka http://localhost:8787
```
Data lokal disimpan di folder `.wrangler/` dan tidak tercampur dengan data online.

## Backup data
Dashboard Cloudflare → D1 → `zimo-db` → **Time Travel** bisa mengembalikan database ke titik waktu mana pun dalam 30 hari terakhir.
Selain itu, unduh CSV laporan tiap bulan dari menu Laporan.

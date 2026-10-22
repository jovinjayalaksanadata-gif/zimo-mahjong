# Zi Mo Mahjong — Website, Booking, POS & Hitung Poin

Isi proyek:

| Halaman | Alamat | Untuk |
|---|---|---|
| Beranda | `/` | Info, harga, lokasi |
| Booking meja | `/booking.html` | Pelanggan pilih tanggal, meja, jam, lalu bayar |
| Cek booking | `/cek.html` | Pelanggan cek status & ganti jadwal (paling lambat H-1) |
| Hitung poin | `/skor.html` | Room skor mahjong 4 pemain, sinkron antar-HP |
| Dashboard staf | `/admin/` | Kasir & meja (timer), booking, transaksi, laporan, menu, pengguna, pengaturan, log |

Teknologinya: **Cloudflare Pages** (website) + **Pages Functions** (API, folder `functions/`) + **D1** (database SQLite).
Semuanya muat di paket gratis Cloudflare untuk 2–3 meja. GitHub dipakai hanya untuk menyimpan kode; Cloudflare otomatis
deploy setiap kali kamu push.

> GitHub Pages saja **tidak bisa** dipakai, karena hanya menyajikan file statis tanpa database.

---

## Deploy pertama kali (±20 menit)

### 1. Upload ke GitHub
1. Buat repository baru di github.com, misalnya `zimo-mahjong` (boleh **Private**).
2. Upload seluruh isi folder ini (kecuali `node_modules` dan `.wrangler` kalau ada).
   Cara paling gampang: di halaman repo klik **Add file → Upload files**, lalu drag semua file & folder.

### 2. Buat database D1
1. Masuk ke dash.cloudflare.com → **Storage & Databases → D1 SQL Database → Create**.
2. Nama: `zimo-db`. Klik **Create**.
3. Salin **Database ID** yang muncul.
4. Buka file `wrangler.toml` di GitHub, ganti `GANTI-DENGAN-DATABASE-ID` dengan ID tadi, lalu commit.

Tabel dibuat otomatis saat website pertama kali dibuka, jadi tidak perlu menjalankan SQL apa pun.

### 3. Buat project Cloudflare Pages
1. dash.cloudflare.com → **Workers & Pages → Create → Pages → Connect to Git**.
2. Pilih repo `zimo-mahjong`.
3. Pengaturan build:
   - Framework preset: **None**
   - Build command: *(kosongkan)*
   - Build output directory: `public`
4. Klik **Save and Deploy**.
5. Binding database `DB` diambil otomatis dari `wrangler.toml`. Cek di **Settings → Bindings**: harus ada D1 `DB` → `zimo-db`.
   Kalau deploy pertama gagal karena ID database belum diganti, perbaiki `wrangler.toml` lalu **Retry deployment**.

### 4. Pasang kode setup (penting)
Supaya orang lain tidak bisa membuat akun pemilik duluan:
1. Project Pages → **Settings → Variables and Secrets → Add**.
2. Nama `SETUP_KEY`, isi dengan kode rahasia buatanmu (misal `zimo-rahasia-2026`), tipe **Secret**.
3. Redeploy.

### 5. Buat akun Superadmin
1. Buka `https://<project>.pages.dev/admin/`.
2. Isi nama, username, password, dan kode setup → **Buat akun Superadmin**.
3. Setelah akun pertama ada, form setup otomatis tertutup selamanya.

### 6. Sambungkan domain
1. Pastikan domain sudah memakai nameserver Cloudflare (di DomaiNesia: ganti nameserver ke yang diberikan Cloudflare).
2. Project Pages → **Custom domains → Set up a custom domain** → ketik domainmu (dan `www.` kalau mau).
3. Cloudflare membuat DNS-nya sendiri. HTTPS aktif otomatis dalam beberapa menit.

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
- Pelanggan bisa ganti jadwal sendiri sampai H-1 lewat `/cek.html`. Tidak ada tombol batal/refund untuk pelanggan.
- Booking yang sudah lunas lalu main lebih lama: kasir hanya menagih **selisih jamnya**.
- Hitung poin: nilai menang = dasar + tai × poin per tai. Zimo dibayar 3 pemain, tembak dibayar pemain yang membuang ubin.
  Semua angka bisa diatur per room.

## Coba di komputer sendiri (opsional)
```bash
npm install
npx wrangler pages dev        # buka http://localhost:8788
```
Data lokal disimpan di folder `.wrangler/` dan tidak tercampur dengan data online.

## Backup data
Dashboard Cloudflare → D1 → `zimo-db` → **Time Travel** bisa mengembalikan database ke titik waktu mana pun dalam 30 hari terakhir.
Selain itu, unduh CSV laporan tiap bulan dari menu Laporan.

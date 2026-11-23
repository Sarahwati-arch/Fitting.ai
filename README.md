# fitting.ai — Milestone 0 spike

Tujuan: menilai apakah overlay baju realtime ke kamera cukup meyakinkan, sebelum membangun auth, storage, dan data layer.
Tidak ada Supabase, R2, atau login di sini. Semua berjalan di browser.

## Menjalankan

```bash
npm install
npm run dev          # http://localhost:3000 (localhost dianggap secure context, kamera boleh)
npm run dev:https    # untuk tes di HP lewat IP jaringan lokal (getUserMedia butuh HTTPS)
```

Alur: upload foto baju → tunggu cutout → Start camera → atur slider Fit sampai pas.

## Isi

| File | Fungsi |
| --- | --- |
| `components/TryOnSpike.tsx` | UI, kamera, render loop (`requestVideoFrameCallback`), FPS meter, cleanup track kamera |
| `lib/pose.ts` | MediaPipe Pose Landmarker (`lite`, GPU dengan fallback CPU) |
| `lib/oneEuro.ts` | One Euro Filter untuk smoothing landmark (dalam piksel) |
| `lib/garmentFit.ts` | Landmark → quad baju; estimasi pinggul kalau tidak terlihat |
| `lib/garmentRenderer.ts` | WebGL: tekstur baju di grid 10×14 yang mengikuti quad |
| `lib/cutout.ts` | Background removal client-side + auto-crop ke bounding box alpha |

Video dan canvas dimirror dalam satu wrapper CSS, jadi koordinat landmark tidak perlu dibalik manual.

## Yang dinilai (gate Milestone 0)

- [ ] Cutout cukup bersih untuk foto baju toko (flat lay, mannequin, model)?
- [ ] Waktu cutout dan ukuran unduhan model di HP mid-range masih bisa diterima?
- [ ] FPS ≥ 24 di laptop dan di HP mid-range?
- [ ] Baju terlihat menempel saat badan bergerak pelan, miring, dan menjauh/mendekat?
- [ ] Smoothing: jitter hilang tanpa terasa lag?
- [ ] Apakah hasilnya terasa seperti "preview tampilan", bukan stiker?

## Keterbatasan yang disengaja

- Belum ada mask oklusi (lengan/tangan belum menimpa baju). Kandidat berikutnya: MediaPipe Image Segmenter.
- Inference masih di main thread. Pindah ke Web Worker kalau FPS kurang.
- Baju hanya di-stretch ke satu quad; belum ada lengkung lengan atau perspektif putar badan.
- Atasan saja. Aspek gambar baju tidak dikunci; atur lewat slider Width/Length.
- Versi `@mediapipe/tasks-vision` di `package.json` harus sama dengan URL WASM di `lib/pose.ts`.

## Lisensi (cek sebelum produksi)

`@imgly/background-removal` berlisensi AGPL-3.0 (ada lisensi komersial terpisah). Dipakai di sini hanya untuk menilai kualitas.
Kalau dipilih, putuskan: beli lisensi, ganti model berlisensi permisif, atau pindah ke cutout server-side.

# Model Pengecualian Fizikal dan Pindaan Obligasi

Status: **DRAF UNTUK SEMAKAN. Tiada kod, tiada skema, tiada migrasi.** Lakaran jadual di bawah hanya untuk menerangkan model dan belum muktamad.

Sumber: sesi simulasi 1 hingga 10 (`tests/stress-sessions.js`) dan arahan Izzat 19/9. Empat temuan yang model ini mesti jawab: pindaan order tiada (S2, S3), baju terlebih tiada tempat (S6), salah saiz tak boleh dinyatakan (S10), dan shipment planned 103 untuk order 100 (S6).

---

## 1. Prinsip yang dikunci

| # | Prinsip | Kesan |
|---|---|---|
| P1 | 1 label = 1 obligasi. Obligasi ialah janji pengeluaran, bukan stok. | Jumlah obligasi aktif sentiasa sama dengan sasaran order. |
| P2 | Jangan edit sejarah. | Perubahan yang menyentuh identiti unit = **batalkan (VOID) obligasi lama + cipta obligasi pengganti**, dipautkan. |
| P3 | Realiti fizikal boleh melebihi atau tak sepadan dengan obligasi. | Objek fizikal tanpa obligasi didaftar sebagai **Unit Pengecualian**, tidak pernah menyumbang kepada pemenuhan order. |
| P4 | Salah saiz ialah **ketakpadanan** antara objek fizikal dan obligasi, bukan suntingan variasi. | Bukti bahawa obligasi M gagal dipenuhi dan satu unit L wujud, kedua-duanya kekal. |
| P5 | Tiada mutasi senyap selepas tampal. | Unit yang sudah bertemu objek fizikal tidak boleh diubah in-place. |
| P6 | Labelism bukan sistem inventori. | Lihat bahagian 8. |

## 2. Perbendaharaan kata

- **Obligasi** = satu baris `units` yang dijana semasa order dicipta. Ia janji: "satu baju ini mesti dikeluarkan untuk penerima ini, saiz ini".
- **Objek fizikal** = baju sebenar. Untuk unit yang dirancang, obligasi dan objek bertemu pada saat **tampal disahkan** (`label_confirmed_at`).
- **Unit Pengecualian (UP)** = objek fizikal yang wujud tanpa obligasi yang memenuhinya. Bukan unit order.
- **Pindaan Order** = satu tindakan beratomik, bernombor (A1, A2...), berstatus tak boleh diubah selepas diterapkan, dengan sebab wajib.
- **VOID** = obligasi dibatalkan sebelum dipenuhi. Kekal dalam rekod, dikecualikan daripada semua kiraan aktif.
- **SUPERSEDE** = obligasi sudah dihantar, digantikan oleh obligasi baru. Yang lama kekal sebagai "sudah dihantar (digantikan)".

## 3. Keadaan obligasi (sedia ada, diterbitkan daripada data)

```
S1 Dijana -> S2 Dicetak (print_run_id) -> S3 Ditampal (label_confirmed_at) -> [Dipek] -> S4 Dihantar (UNIT_DISPATCHED) -> [Dipulang]
```

Empat keadaan yang diminta untuk pindaan:

| Kod | Keadaan | Objek fizikal wujud? |
|---|---|---|
| **S1** | Sebelum dicetak | Tidak |
| **S2** | Dicetak, belum ditampal | Label kertas wujud, baju belum terikat |
| **S3** | Ditampal, belum dihantar (termasuk yang sudah dipek) | Ya, di kilang |
| **S4** | Sudah dihantar | Ya, di tangan pelanggan |

## 4. Jadual pindaan: keadaan × jenis perubahan

Tiga jenis perubahan: **Nama** penerima, **Variasi/saiz** (termasuk produk), **Kuantiti** (kurang atau lebih).

### 4.1 Nama penerima

| | Mekanisme | Obligasi baru? | Akibat fizikal | Jejak |
|---|---|---|---|---|
| **S1** | Pembetulan di tempat (label belum wujud) | Tidak | Tiada | Event `NAME_CORRECTED {lama, baru}` + pindaan |
| **S2** | Pembetulan + label lama dimatikan (token diputar), cetak semula | Tidak (baju belum wujud) | Label kertas lama mesti dibuang | `NAME_CORRECTED` + `LABEL_REISSUED` |
| **S3** | Bergantung **Soalan 1** (nama ada pada baju atau hanya pada label?) | | | |
| | 3a. Nama hanya pada label: label diganti (mekanisme reissue sedia ada) + `NAME_CORRECTED` | Tidak | Label lama dibuang, label baru ditampal semula | `NAME_CORRECTED` + `DAMAGE_OBSERVED` + `LABEL_REISSUED` |
| | 3b. Nama pada baju (dicetak/dijahit): baju itu salah | **Ya**: VOID + pengganti | Baju lama jadi UP asal `VOID_RELEASED` | Pindaan + UP + pautan `replaces` |
| **S4** | Tidak boleh diubah. Jika pelanggan mahu baju baru: **SUPERSEDE** | Ya (pengganti) | Baju lama dipulang melalui Return Intake (sedia ada), atau pelanggan simpan | `replaces` + pindaan |

### 4.2 Variasi / saiz

Sentiasa menyentuh identiti (unit milik satu variasi). Tiada suntingan variasi pada unit. Sentiasa VOID + pengganti.

| | Mekanisme | Akibat fizikal | Catatan |
|---|---|---|---|
| **S1** | VOID lama, cipta pengganti pada variasi baru | Tiada | Jumlah aktif tak berubah |
| **S2** | VOID lama (label kertas dimatikan), cipta pengganti | Label kertas lama dibuang | Scan label mati memberi mesej jelas (bahagian 7) |
| **S3** | VOID lama, cipta pengganti | Baju lama jadi **UP** (`VOID_RELEASED`), operator wajib pilih tindakan | UP hanya boleh ditukar kepada obligasi jika variasinya sama (bahagian 6) |
| **S4** | SUPERSEDE + Return Intake baju lama | Baju lama dipulang | Lama kekal "dihantar (digantikan)" |

### 4.3 Kuantiti

| | Kurang | Lebih |
|---|---|---|
| **S1** | VOID n unit. Jika ada nama: pilih unit ikut nama/kod. Jika tiada nama: sistem cadang unit dengan kemajuan paling rendah. | Sasaran baris naik k, cipta k obligasi baru (belum dicetak). |
| **S2** | VOID unit. Cadangan: yang belum dicetak dahulu. Label kertas unit dicetak dimatikan. | Sama seperti S1. Obligasi baru masuk cetakan seterusnya. |
| **S3** | VOID unit ditampal **hanya jika dipilih secara eksplisit**. Setiap baju jadi UP (`VOID_RELEASED`). Sistem tak pernah pilih unit ditampal secara automatik. | Sama seperti S1. |
| **S4** | Tiada VOID. Pengurangan selepas hantar = pelanggan pulangkan. Sasaran diturunkan oleh pindaan **selepas** QC pemulangan selesai. Nilai wang di luar skop Labelism. Lihat **Soalan 9**. | Sama seperti S1 (obligasi tambahan, penghantaran baru). |

### 4.4 Peraturan merentas keadaan

- **Unit yang sudah dipek (S3b)**: pindaan yang menyentuhnya **ditolak** sehingga unit dikeluarkan daripada packing melalui tindakan berjejak `SHIPMENT_UNIT_REMOVED` (belum wujud, keperluan prasyarat; Soalan 4).
- **Pindaan bukan draf**: sistem menunjukkan **pelan** (unit mana di-VOID, unit mana dicipta, baju mana jadi UP), pengguna sahkan, kemudian ia diterap dalam satu transaksi. Pelan menyimpan keadaan setiap unit semasa dijana; jika berubah sebelum sahkan (contoh operator lain baru cetak), pindaan ditolak dengan "keadaan berubah, jana pelan semula".
- **VOID tidak boleh dibatalkan**. Kesilapan pindaan dibetulkan dengan pindaan baru.
- **Medan pengepala order** (tarikh order, tarikh siap, nota, no. rujukan) ialah suntingan biasa dengan log perubahan. Ia tidak menyentuh obligasi.

## 5. Model data (lakaran, bukan muktamad)

Kekal: `units` ialah obligasi. Tiada jadual inventori.

```
units            + voided_at, void_reason, amendment_id, replaces_unit_id, superseded_at
order_lines      + target_quantity   (asal = quantity_ordered; naik/turun mengikut pindaan)
order_amendments   id, order_id, number, actor, reason (wajib), created_at   (tak boleh diubah)
amendment_items    amendment_id, unit_id, action (VOID | CREATE | NAME_CORRECTED | SUPERSEDE), payload
exception_units    id, code (EXC-nnnnnn, jujukan global), token, variant_observed,
                   origin (OVERPRODUCTION | WRONG_SIZE | VOID_RELEASED | FOUND),
                   order_id (konteks), related_unit_id, disposition, decided_by, decided_at,
                   converted_to_unit_id, location, reason
```

Kiraan baris order selepas model ini:

| Angka | Takrif |
|---|---|
| Ditempah asal | `quantity_ordered` (tak berubah) |
| Pindaan (+/-) | jumlah pindaan kuantiti |
| Sasaran semasa | `target_quantity` |
| Obligasi aktif | unit tidak VOID dan tidak SUPERSEDED |
| Dibatalkan | unit VOID |
| Dihantar (digantikan) | unit SUPERSEDED yang sudah dihantar |
| Pengecualian | jumlah UP mengikut disposisi, **dipaparkan berasingan** |

Invarian (ujian penerimaan mesti menjaga):

- **I1** Obligasi aktif = sasaran semasa apabila penjanaan selesai.
- **I2** Satu obligasi aktif mempunyai paling banyak satu token label hidup.
- **I3** Unit VOID tidak boleh dicetak, ditampal, dipek, dihantar atau dipulang sebagai unit order.
- **I4** Tiada pindaan mengubah medan unit di S3 atau S4 di tempat.
- **I5** Setiap pindaan ada pelaku, sebab, masa dan rujukan unit lama/baru.
- **I6** UP tidak masuk kiraan ditempah, dijana, dipek atau dihantar. UP tidak boleh dimasukkan ke shipment.
- **I7** Shipment: `planned` tidak boleh melebihi obligasi tertunggak baris itu (bahagian 9).

## 6. Unit Pengecualian

### 6.1 Sumber (empat sahaja)

| Asal | Bila | Contoh |
|---|---|---|
| `OVERPRODUCTION` | Operator jumpa baju tanpa label semasa packing | 103 baju untuk order 100 |
| `WRONG_SIZE` | Baju berlabel obligasi M rupanya L | Label M ditampal pada baju L |
| `VOID_RELEASED` | Pindaan membatalkan obligasi yang sudah ditampal | Pelanggan tukar saiz selepas tampal |
| `FOUND` | Baju tanpa label ditemui kemudian dan tiada penjelasan | (jarang; disertakan supaya tak dipaksa masuk asal lain) |

### 6.2 Pendaftaran

Operator mendaftar baju: pilih order konteks (wajib), variasi yang **diperhatikan**, sebab. Setiap UP menerima kod `EXC-nnnnnn` dan **label yang jelas berbeza** (contoh sepanduk "LEBIHAN"), supaya tak boleh dikelirukan dengan label obligasi. Jika UP tak dilabel, objek fizikal itu kekal tanpa jejak, iaitu masalah asal.

Scan label UP di packing atau return mesti menolak dengan mesej khusus: "Ini Unit Pengecualian EXC-000123, bukan unit order. Belum boleh dipek."

### 6.3 Disposisi (operator wajib pilih; tiada jawapan lalai)

| Disposisi | Maksud | Terminal? |
|---|---|---|
| `PENDING` | Baru didaftar, belum diputuskan | Tidak |
| `REJECTED` | Dibuang atau dilupuskan. Sebab wajib. | Ya |
| `SPARE` | Disimpan. Rekod dengan lokasi. **Tiada kuantiti stok, tiada padanan, tiada tempahan.** | Tidak |
| `CONVERTED` | Diikat kepada obligasi baru (6.4) | Ya |

`PENDING` tidak menyekat kerja lantai (packing dan dispatch diteruskan). Ia dipaparkan **merah** pada Butiran order dan pada satu senarai "Pengecualian belum diputuskan". Lihat Soalan 3.

### 6.4 Tukar kepada obligasi (CONVERT)

Syarat, semuanya wajib:

1. Wujud pindaan sah pada **order asal UP itu** yang mencipta obligasi baru O'.
2. Variasi UP **sama** dengan variasi O'. Tiada penukaran variasi pada UP.
3. Pelaku dan sebab direkod.

Hasil: label O' dianggap ditampal pada baju UP (event `BOUND`), UP jadi `CONVERTED` (tokennya mati), O' berstatus ditampal dengan nota "dipenuhi oleh EXC-...". Kedua-dua rekod kekal. **Tiada penukaran merentas order dalam v1** (itu inventori; lihat bahagian 8).

## 7. Salah saiz sebagai ketakpadanan

Kes: order minta M, baju fizikal ialah L.

1. Operator menyatakan "salah saiz" pada unit O (variasi M, ditampal), memilih variasi sebenar (L).
2. Sistem merekod `MISMATCH_DETECTED {dijangka: M, diperhatikan: L}` pada O. **O tidak diubah dan tidak dipenuhi.**
3. Label O dimatikan dengan mekanisme reissue selepas tampal (sedia ada): token diputar, status tampal dikosongkan. O kembali tertunggak dan perlu baju M.
4. Sistem mencipta UP `WRONG_SIZE` (variasi L, `related_unit_id` = O), disposisi `PENDING`.
5. Operator memutuskan UP: `REJECTED` / `SPARE` / atau **jika pelanggan terima L**: pindaan saiz M ke L pada O (keadaan sekarang S2, bersih), yang VOID O dan mencipta O' (L); UP L ditukar kepada O' (6.4).

Bukti kekal: O ada `MISMATCH_DETECTED`, UP menunjuk asalnya kepada O, O' `replaces` O. Variasi tiada unit yang pernah diubah.

## 8. Apa yang TIDAK dibina

- **Tiada inventori umum.** Tiada kuantiti stok mengikut variasi, tiada "berapa M ada dalam stor", tiada carian atau padanan SPARE merentas order.
- **Tiada lejar stok gudang penuh.** Lokasi SPARE hanyalah petunjuk di mana objek itu, bukan lejar.
- **Tiada suntingan unit sesuka hati.** Tiada `PATCH /units/:id`. Perubahan hanya melalui pindaan.
- **Tiada mutasi senyap selepas tampal.** Tiada perubahan nama, variasi atau kuantiti pada unit ditampal tanpa pindaan berjejak yang menghasilkan VOID dan UP, atau reissue berjejak.
- **Tiada rekonsiliasi automatik yang menganggap lebihan sebagai pemenuhan.** Baju terlebih tidak pernah "mengisi" order yang kurang secara automatik; hanya CONVERT eksplisit oleh operator.
- **Tiada padanan silang order** (baju terlebih pelanggan A dihantar kepada pelanggan B). Jika suatu hari perlu, ia keputusan berasingan, bukan lanjutan senyap model ini.
- **Tiada draf pindaan yang boleh disunting berhari-hari.** Pelan sahkan-atau-buang sahaja.
- **Tiada kelulusan berbilang peringkat, refund, invois, atau nilai wang.**
- **Tiada penghantaran semula unit dipulang.** Itu jurang sedia ada dan bukan skop di sini.

Jaminan: jika ada permintaan untuk "senarai semua SPARE ikut saiz", ia isyarat model sedang menjadi inventori dan mesti ditolak atau dibawa sebagai keputusan seni bina baru.

## 9. Peraturan shipment (boleh ditutup bersama)

**`planned_quantity` sesebuah shipment tidak boleh melebihi obligasi tertunggak baris order.**

```
tertunggak(baris) = sasaran semasa
                  - unit yang sudah dihantar (bukan SUPERSEDED)
                  - planned shipment lain yang belum dihantar dan belum dibatalkan
```

Planned 103 untuk order 100 gagal. Kenaikan hanya jika pindaan menaikkan sasaran dahulu. Sebelum pindaan dibina, `sasaran semasa` = `quantity_ordered`, jadi peraturan ini boleh dilaksanakan bersendirian tanpa menunggu model ini. Berlaku pada `createShipment` dan pada permulaan packing cetakan.

## 10. Satu konsep atau dua domain?

**Cadangan: dua konsep kecil dengan satu sempadan, bukan satu konsep bergabung dan bukan dua sistem berasingan.**

| | Pindaan Obligasi | Unit Pengecualian |
|---|---|---|
| Domain | Janji pengeluaran | Realiti fizikal |
| Pencetus | Kertas / pelanggan | Lantai / operator |
| Pelaku | Admin atau staf pejabat | Operator lantai |
| Invarian | Jumlah obligasi = sasaran | Objek fizikal tak boleh tanpa jejak |
| Ubah kiraan order? | Ya | **Tidak pernah** |

Sebab dipisahkan: pencetus, pelaku dan invarian berbeza. Jika digabung, satu `units` menampung "janji" dan "objek tanpa janji" dengan status campur, itulah percampuran obligasi dan inventori yang ingin dielakkan.

**Sempadan (kontrak):**

1. UP tidak muncul dalam kiraan obligasi, dan obligasi tidak muncul dalam senarai UP.
2. Hanya tiga lintasan: `MISMATCH_DETECTED` (obligasi mencipta UP), `VOID_RELEASED` (pindaan mencipta UP), dan `BOUND` (UP diikat kepada obligasi melalui CONVERT).
3. Setiap lintasan ialah tindakan operator berjejak. Tiada padanan automatik.

## 11. Jawapan audit Sesi 10 di bawah model ini

| Soalan | Sumber |
|---|---|
| Ditempah (asal, pindaan, semasa) | order line |
| Obligasi diwajibkan, dibatalkan | unit aktif, unit VOID |
| Dicetak, ditampal, dipek, dihantar, dipulang | sedia ada |
| Baju terlebih | UP `OVERPRODUCTION` |
| Baju salah saiz | `MISMATCH_DETECTED` + UP `WRONG_SIZE` |
| Perubahan order selepas cetak | pindaan berjejak |
| Baju fizikal sebenar di lantai | unit ditampal tidak dihantar + UP bukan REJECTED |

## 12. Soalan untuk Izzat (dengan lalai yang dicadangkan)

1. **Nama penerima: pada baju atau hanya pada label?** Menentukan S3 (3a atau 3b). Lalai: anggap pada baju (3b, lebih selamat) sehingga dijawab.
2. **Siapa boleh terapkan pindaan?** Lalai: staf boleh S1 dan S2; S3 dan S4 (ada akibat fizikal) admin sahaja.
3. **UP `PENDING` menyekat apa-apa?** Lalai: tidak menyekat, tetapi merah pada Butiran.
4. **Keluarkan unit daripada packing** (`SHIPMENT_UNIT_REMOVED`) perlu dibina sebagai prasyarat S3b. Lalai: ya, tindakan admin berjejak.
5. **Unit dipulang tidak boleh dihantar semula** hari ini. Bukan skop, tetapi mempengaruhi S4. Lalai: tangguh.
6. **Label UP di lantai packing:** boleh dicetak pada pencetak sama? Lalai: ya, kertas sama, sepanduk "LEBIHAN".
7. **CONVERT merentas order:** lalai tidak (bahagian 8).
8. **Penomboran pindaan:** A1, A2 per order. Lalai: ya.
9. **Kuantiti kurang selepas hantar:** Labelism hanya merekod pemulangan, nilai wang di luar. Lalai: ya.
10. **Pengepala order boleh diedit dengan log?** Lalai: ya.

## 13. Urutan pembinaan yang dicadangkan (selepas model diluluskan)

| Fasa | Kandungan | Ujian penerimaan utama |
|---|---|---|
| 0 | Peraturan shipment (bahagian 9) | Planned 103 untuk 100 gagal; 100 berjaya |
| 1 | Pindaan S1 dan S2 (VOID, pengganti, nama, kuantiti) | I1 hingga I5; scan label mati memberi mesej jelas; pelan basi ditolak |
| 2 | Unit Pengecualian: overproduction, disposisi | I6; UP tidak masuk kiraan; scan UP di packing ditolak |
| 3 | Salah saiz (MISMATCH) + CONVERT | Bukti O dan UP kekal; variasi tiada unit berubah |
| 4 | Pindaan S3 dan S4 (VOID_RELEASED, SUPERSEDE, keluarkan dari packing) | Setiap baju ditampal yang di-VOID menghasilkan UP; audit Sesi 10 dijawab tanpa "agak-agak" |

Setiap fasa: ujian penerimaan ditulis dahulu, `stress-sessions.js` yang berkaitan bertukar daripada temuan kepada lulus, tiada deploy tanpa semakan Izzat.

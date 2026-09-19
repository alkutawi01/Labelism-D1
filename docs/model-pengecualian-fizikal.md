# Model Pengecualian Fizikal dan Pindaan Obligasi

Status: **DRAF UNTUK SEMAKAN. Tiada kod, tiada skema, tiada migrasi.** Lakaran jadual di bawah hanya untuk menerangkan model dan belum muktamad.

**Keputusan dikunci 19/9 (versi akhir; menggantikan jawapan awal jika bercanggah):**

1. **Nama di baju (dijelaskan dan dibetulkan Izzat 19/9; ia BUKAN "nama penerima". Pelanggan ialah, contohnya, Sekolah Menengah Kota; nama di baju ialah nama pelajar: Amin, Ahmad, Ali):** sesetengah order mahu nama pada baju, sesetengah tidak. Jika dokumen order menulis "baju ini perlu nama X", nama itu **ada pada baju**; jika tidak ditulis, **tiada**. Nama itu **WAJIB ada pada label** supaya **semasa packing baju tidak tertukar, terlebih atau terkurang**. Maka: unit yang mempunyai nama di baju (lajur `recipient_name` dalam pangkalan data, nama teknikal lama) ialah **baju diperibadikan** (nama pada baju); unit tanpa nama ialah baju generik. Ini diterbitkan daripada data order, bukan soalan kepada operator. Nama pada baju ialah sebahagian spesifikasi pengeluaran, sama seperti saiz.
2. Salah saiz **tidak menulis `DAMAGE_OBSERVED`**. Mekanisme reissue diubah supaya membawa sebab yang tepat (bahagian 7.1). Tiada perbendaharaan event baru.
3. **Tiada hierarki peranan** (staf/admin) sebagai keperluan seni bina. Sistem hanya merekod siapa melakukan pindaan dan memberi pengesahan yang jelas apabila ada akibat fizikal.
4. `quantity_ordered` **tidak pernah ditulis semula** (invarian I8).
5. `exception_units` v1 dikurangkan kepada apa yang benar-benar digunakan (bahagian 5 dan 6).
6. Dua konsep (Pindaan Obligasi + Unit Pengecualian), sempadan tiga lintasan, VOID + pengganti untuk saiz: **dikekalkan**.
7. **Fasa 0 (peraturan shipment) diluluskan untuk dibina dahulu.** Fasa 1 hingga 4 belum, dan tidak boleh dibina serentak.

Model dalam satu ayat: *order menentukan berapa baju wajib dibuat; setiap obligasi ada label; jika order berubah rekod lama tidak dipadam; jika realiti kilang tak sepadan dengan order, objek fizikal itu direkod sebagai pengecualian; hanya tindakan manusia boleh menyambungkan pengecualian kepada obligasi.*

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

- **Obligasi** = satu baris `units` yang dijana semasa order dicipta. Ia janji: "satu baju ini mesti dikeluarkan untuk order ini, saiz ini, dengan nama ini jika ada".
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

Tiga jenis perubahan: **Nama di baju**, **Variasi/saiz** (termasuk produk), **Kuantiti** (kurang atau lebih).

### 4.1 Nama di baju

**Takrif.** Unit berperibadi = unit yang ada nama di baju (daripada dokumen order). Nama itu ada pada baju dan pada label. Unit generik = tiada nama. Menambah nama pada unit generik, mengubah, atau membuang nama pada unit berperibadi ialah **perubahan spesifikasi baju**, jadi ia menyentuh identiti seperti perubahan saiz.

Apa yang tidak diketahui Labelism ialah sama ada kilang **sudah menghasilkan** baju dengan nama lama, sebelum label ditampal (kilang bekerja daripada dokumen, bukan daripada Labelism). Maka satu pengisytiharan operator, hanya untuk perubahan nama:

> "Baju dengan nama lama **sudah dihasilkan**?" Ya / Tidak

| | Tidak (baju belum dihasilkan) | Ya (baju sudah dihasilkan) |
|---|---|---|
| **S1** belum cetak | Betulkan di tempat: `NAME_CORRECTED {lama, baru}` + pindaan | VOID + pengganti + Unit Pengecualian (baju bernama lama) |
| **S2** dicetak, belum ditampal | Betulkan, matikan label kertas lama (token diputar), cetak baru: `NAME_CORRECTED` + `LABEL_REISSUED` sebab `NAME_CORRECTION` | VOID + pengganti + Unit Pengecualian; label kertas lama dimatikan |
| **S3** ditampal, belum dihantar | Tidak terpakai: baju sudah wujud dengan nama lama, **jawapan sentiasa "Ya"** | **VOID + pengganti + Unit Pengecualian `VOID_RELEASED`.** Tiada "tukar label sahaja". |
| **S4** dihantar | Tidak boleh diubah. Jika pelanggan mahu baju bernama baru: **SUPERSEDE** (obligasi pengganti, baju lama dipulang melalui Return Intake atau pelanggan simpan) | sama |

Baju bernama lama yang menjadi UP biasanya **REJECTED** atau **SPARE** (nama pelajar lain tidak sesuai untuk pelajar baru). CONVERT hanya jika satu obligasi baru pada order yang sama memang sesuai dengannya (contoh: nama yang sama diperlukan semula).

Unit generik yang tiada nama dan tiada nama dimahukan: tiada apa untuk diubah; perubahan saiz dan kuantiti ikut 4.2 dan 4.3.

Reissue selepas tampal sedia ada (yang hanya menukar QR) **bukan** cara membetulkan nama. Ia kekal untuk label rosak sahaja.

### 4.1.1 Nama pada label semasa packing

Nama pada label ada tujuan operasi: pembungkus memadankan nama pada baju dengan nama pada label. **Ini WAJIB.**, supaya baju tidak tertukar. Hari ini, hasil scan packing **tidak memaparkan nama di baju** (hanya produk, variasi dan kod), jadi padanan itu bergantung sepenuhnya kepada mata pembungkus. Cadangan kecil, belum dibina dan belum diluluskan: hasil scan packing memaparkan nama di baju dengan jelas untuk unit berperibadi, sebagai bantuan pengesahan (bukan sekatan). Ini bukan sebahagian fasa 0 hingga 4.

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

- **Unit yang sudah dipek tetapi belum dihantar**: pindaan yang menyentuhnya **ditolak** sehingga unit dikeluarkan daripada packing. Prasyarat yang wajib dibina: satu tindakan **"Keluarkan dari packing"** dengan **sebab wajib dan pelaku wajib**, satu event `SHIPMENT_UNIT_REMOVED`, buang keahlian `shipment_units`, dan kira semula shipment (dipek/planned). Bukan subsistem baru.
- **Pengesahan, bukan peranan**: pindaan dengan akibat fizikal (label pada baju ditukar, baju jadi Unit Pengecualian) menunjukkan dialog yang menyatakan akibat itu secara jelas sebelum disahkan. Pelaku direkod. Tiada sekatan mengikut peranan dalam v1.
- **Pindaan bukan draf**: sistem menunjukkan **pelan** (unit mana di-VOID, unit mana dicipta, baju mana jadi UP), pengguna sahkan, kemudian ia diterap dalam satu transaksi. Pelan menyimpan keadaan setiap unit semasa dijana; jika berubah sebelum sahkan (contoh operator lain baru cetak), pindaan ditolak dengan "keadaan berubah, jana pelan semula".
- **VOID tidak boleh dibatalkan**. Kesilapan pindaan dibetulkan dengan pindaan baru.
- **Medan pengepala order** (tarikh order, tarikh siap, nota, no. rujukan) ialah suntingan biasa dengan log perubahan. Ia tidak menyentuh obligasi.

## 5. Model data (lakaran, bukan muktamad)

Kekal: `units` ialah obligasi. Tiada jadual inventori.

```
units            + voided_at, void_reason, amendment_id, replaces_unit_id, superseded_at
order_lines      quantity_ordered  (ASAL. TIDAK PERNAH DITULIS SEMULA)
order_amendments   id, order_id, number, actor, reason (wajib), quantity_delta per baris, created_at   (tak boleh diubah)
amendment_items    amendment_id, unit_id, action (VOID | CREATE | NAME_CORRECTED | SUPERSEDE), payload
exception_units    id, code (EXC-..., unik), order_id (konteks), variant_observed,
                   origin (OVERPRODUCTION | WRONG_SIZE | VOID_RELEASED | FOUND),
                   disposition (PENDING | REJECTED | SPARE | CONVERTED),
                   related_unit_id (jika ada), converted_to_unit_id, reason, actor, created_at, decided_at
```

Sengaja **tiada** dalam v1: jejak lokasi, jujukan global yang rumit, carian atau indeks stok, token label dengan mesin khas. `code` cuma perlu unik dan jelas.

Kiraan baris order selepas model ini:

| Angka | Takrif |
|---|---|
| Ditempah asal | `quantity_ordered` (tak pernah berubah) |
| Pindaan bersih (+/-) | jumlah `quantity_delta` semua pindaan baris itu |
| Sasaran semasa | `quantity_ordered` + pindaan bersih (diterbitkan; tidak menggantikan `quantity_ordered`) |
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
- **I8** `quantity_ordered` tidak pernah ditulis semula. Sasaran semasa sentiasa = `quantity_ordered` + jumlah `quantity_delta`, jadi audit boleh menghasilkan semula kedua-duanya pada bila-bila masa. Ini dikunci kerana audit kemudian bergantung kepadanya.
- **I9** (WAJIB, Izzat 19/9) Setiap unit yang mempunyai nama di baju mesti memaparkan nama itu pada labelnya, dan nama itu mesti **muat dan boleh dibaca** pada semua saiz label yang disokong (tidak terpotong, tidak tercicir ke halaman lain). Label yang tak memuatkan nama = label yang gagal.
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

Operator mendaftar baju: pilih order konteks (wajib), variasi yang **diperhatikan**, sebab. Setiap UP menerima kod `EXC-...` yang unik dan **label yang jelas berbeza**: teks besar **"PENGECUALIAN"** (bukan "LEBIHAN", kerana asal UP juga boleh salah saiz, baju yang dilepaskan atau ditemui), pada pencetak dan kertas yang sama. Ia tidak boleh dikelirukan dengan label obligasi. Jika UP tak dilabel, objek fizikal itu kekal tanpa jejak, iaitu masalah asal.

Scan label UP di packing atau return mesti menolak dengan mesej khusus: "Ini Unit Pengecualian EXC-000123, bukan unit order. Belum boleh dipek."

### 6.3 Disposisi (operator wajib pilih; tiada jawapan lalai)

| Disposisi | Maksud | Terminal? |
|---|---|---|
| `PENDING` | Baru didaftar, belum diputuskan | Tidak |
| `REJECTED` | Dibuang atau dilupuskan. Sebab wajib. | Ya |
| `SPARE` | "Baju ini masih ada, jangan buang rekodnya." **Bukan stok**: tiada kuantiti, tiada lokasi, tiada carian, tiada padanan dengan order lain. | Tidak |
| `CONVERTED` | Diikat kepada obligasi baru (6.4) | Ya |

`PENDING` tidak menyekat order atau penghantaran lain. UP itu sendiri tidak boleh masuk packing atau pemenuhan. Ia dipaparkan **merah** pada Butiran order dan pada satu senarai "Pengecualian belum diputuskan". Lihat Soalan 3.

### 6.4 Tukar kepada obligasi (CONVERT)

Syarat, semuanya wajib:

1. Wujud pindaan sah pada **order asal UP itu** yang mencipta obligasi baru O'.
2. Variasi UP **sama** dengan variasi O'. Tiada penukaran variasi pada UP.
3. Pelaku dan sebab direkod.

Hasil: label O' dianggap ditampal pada baju UP (event `BOUND`), UP jadi `CONVERTED` (tokennya mati), O' berstatus ditampal dengan nota "dipenuhi oleh EXC-...". Kedua-dua rekod kekal. **Tiada penukaran merentas order dalam v1** (itu inventori; lihat bahagian 8).

## 7. Salah saiz sebagai ketakpadanan

Kes: order minta M, baju fizikal ialah L.

1. Operator menyatakan "salah saiz" pada unit O (variasi M, ditampal) dan memilih variasi sebenar (L).
2. `MISMATCH_DETECTED {dijangka: M, diperhatikan: L}` direkod pada O. **O tidak diubah dan tidak dipenuhi.**
3. Token lama dimatikan dan status tampal dikosongkan, direkod sebagai `LABEL_REISSUED` dengan sebab `WRONG_SIZE`. **Tiada `DAMAGE_OBSERVED`**, kerana label tidak rosak. O kembali tertunggak dan perlu baju M.
4. Unit Pengecualian `WRONG_SIZE` (variasi L, `related_unit_id` = O) dicipta, `PENDING`.
5. Operator memutuskan UP: `REJECTED` / `SPARE` / atau jika pelanggan terima L: pindaan saiz M ke L pada O (O kini bersih pada S2, jadi VOID + pengganti O' variasi L), kemudian UP ditukar kepada O' (6.4).

Bukti kekal: O ada `MISMATCH_DETECTED`, UP menunjuk asalnya kepada O, O' `replaces` O. Tiada unit yang variasinya pernah diubah.

### 7.1 Perubahan mekanisme reissue (prasyarat fasa yang menggunakannya)

Reissue selepas tampal hari ini **sentiasa** menulis `DAMAGE_OBSERVED` dan sebab "label rosak/hilang". Ia dibetulkan supaya menerima **sebab yang tepat**, bukan dengan menambah perbendaharaan event baru:

| Sebab | `DAMAGE_OBSERVED`? | Digunakan oleh |
|---|---|---|
| `LABEL_DAMAGED` (lalai, tingkah laku semasa) | Ya | Label rosak atau hilang |
| `NAME_CORRECTION` | Tidak | Pembetulan nama (4.1) |
| `WRONG_SIZE` | Tidak | Aliran salah saiz (bahagian 7) |

Event yang sentiasa ditulis: `LABEL_REISSUED` dengan `payload.reason` yang benar. Panggilan sedia ada tidak berubah tingkah laku (lalai `LABEL_DAMAGED`).

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

Planned 103 untuk order 100 gagal. Kenaikan hanya jika pindaan menaikkan sasaran dahulu.

Butiran yang dikunci untuk Fasa 0:
- "Shipment lain" dikira mengikut keadaan: **OPEN** = `planned_quantity`; **CLOSED** dan **DISPATCHED** = bilangan unit sebenar dalam shipment (shipment ditutup dengan kekurangan tidak menahan baki yang tak pernah dipek). Dibatalkan diabaikan.
- Semakan mesti **atomik** dalam SQL (sisipan bersyarat, seperti tambah-batch sedia ada) supaya dua shipment yang dicipta serentak tidak masing-masing merancang baki yang sama.
- Berlaku pada `createShipment` (API langsung) dan disemak pada permulaan packing cetakan.
- Mesej ralat menyebut baki tertunggak sebenar. Sebelum pindaan dibina, `sasaran semasa` = `quantity_ordered`, jadi peraturan ini boleh dilaksanakan bersendirian tanpa menunggu model ini. Berlaku pada `createShipment` dan pada permulaan packing cetakan.

## 10. Satu konsep atau dua domain?

**Cadangan: dua konsep kecil dengan satu sempadan, bukan satu konsep bergabung dan bukan dua sistem berasingan.**

| | Pindaan Obligasi | Unit Pengecualian |
|---|---|---|
| Domain | Janji pengeluaran | Realiti fizikal |
| Pencetus | Kertas / pelanggan | Lantai / operator |
| Pelaku | Staf pejabat (pelaku direkod, tiada sekatan peranan) | Operator lantai |
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

## 12. Keputusan (dikunci 19/9)

| # | Soalan | Keputusan |
|---|---|---|
| 1 | Nama pada baju atau label? | **Kedua-duanya, bergantung order.** Nama dalam dokumen order = nama pada baju dan pada label (untuk pengesahan packing). Tiada nama dalam dokumen = tiada nama. Unit dengan `recipient_name` ialah baju diperibadikan (bahagian 4.1). |
| 2 | Siapa boleh terapkan pindaan? | **Tiada hierarki peranan.** Rekod pelaku; pengesahan lebih jelas untuk akibat fizikal. Sekatan peranan hanya jika operasi sebenar memerlukannya. |
| 3 | UP `PENDING` menyekat apa? | Tidak menyekat order atau penghantaran lain. UP tidak boleh masuk packing/pemenuhan. Amaran merah sehingga diputuskan. |
| 4 | Keluarkan unit dari packing | **Ya, wajib bina.** Satu tindakan, sebab dan pelaku wajib, satu event, buang keahlian, kira semula shipment. |
| 5 | Hantar semula unit dipulang | **Tangguh.** Di luar model ini. |
| 6 | Label UP | Pencetak/kertas sama; teks besar **"PENGECUALIAN"** + kod `EXC-...`. |
| 7 | CONVERT merentas order | **Tidak.** Order asal sahaja. |
| 8 | Nombor pindaan | `A1`, `A2`... per order, tak boleh diubah selepas diterap. |
| 9 | Kuantiti kurang selepas hantar | Labelism merekod pemulangan; kuantiti diturunkan hanya selepas keadaan fizikal unit jelas. Refund/kredit/invois di luar skop. |
| 10 | Pengepala order | Boleh diedit dengan log perubahan, tanpa VOID. No. rujukan lama kekal dalam log. |
| 11 | Bila nama dikenakan pada baju | **Dijawab dengan satu pengisytiharan operator** pada perubahan nama S1 dan S2: "baju bernama lama sudah dihasilkan?" (bahagian 4.1). |

## 13. Urutan pembinaan

| Fasa | Kandungan | Status | Ujian penerimaan utama |
|---|---|---|---|
| **0** | Peraturan shipment (bahagian 9) | **DILULUSKAN, dibina dahulu** | Planned 103 untuk 100 gagal; 100 berjaya; dua shipment serentak tak boleh merancang baki sama |
| 1 | Pindaan S1 dan S2 (VOID, pengganti, nama, kuantiti) + I8 | Belum | I1 hingga I5, I8; scan label mati memberi mesej jelas; pelan basi ditolak |
| 2 | Unit Pengecualian: overproduction, disposisi, label "PENGECUALIAN" | Belum | I6; UP tidak masuk kiraan; scan UP di packing ditolak |
| 3 | Reissue dengan sebab (7.1), salah saiz (MISMATCH) + CONVERT | Belum | Tiada `DAMAGE_OBSERVED` pada salah saiz; O dan UP kekal; tiada unit variasi diubah |
| 4 | "Keluarkan dari packing", pindaan S3 dan S4 (VOID_RELEASED, SUPERSEDE) | Belum | Setiap baju ditampal yang di-VOID menghasilkan UP; audit Sesi 10 dijawab tanpa "agak-agak" |

Setiap fasa: ujian penerimaan ditulis dahulu; `stress-sessions.js` yang berkaitan bertukar daripada temuan kepada lulus; fasa 1 hingga 4 dibina **satu demi satu**, masing-masing dengan kelulusan; tiada deploy tanpa semakan Izzat.

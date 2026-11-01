# Inter — report theme "Modern — Inter"

Static TrueType instances (Regular, Italic, SemiBold 600, Bold 700) of **Inter 4.0**
(https://github.com/rsms/inter/releases/tag/v4.0, `Inter-4.0.zip`, `extras/ttf`),
(c) 2016 The Inter Project Authors. Licensed under the SIL Open Font License 1.1 —
see `OFL.txt`. Inter declares no Reserved Font Name.

The only change is a size trim: each face was subset (fonttools `pyftsubset`) to
Basic Latin, Latin-1, Latin Extended A/B + Additional, Greek, general punctuation,
superscripts, currency, letterlike symbols, arrows, maths operators and a few marks
(U+0020-007E, 00A0-024F, 0370-03FF, 1E00-1EFF, 2000-206F, 2070-209F, 20A0-20CF, 2100-214F,
2190-21FF, 2200-22FF, 25A0-25FF, 2460-24FF, 2713, 2717) keeping the `kern`, `liga`,
`calt`, `tnum`, `case` features — about 175 KB a face instead of 410 KB.

Embedded (subset again by jsPDF) in report PDFs only when a lab picks the Inter
theme; fetched lazily by `shared/utils/report-fonts.ts` — never part of the app bundle.

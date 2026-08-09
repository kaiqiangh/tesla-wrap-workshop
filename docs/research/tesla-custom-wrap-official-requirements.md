# Tesla Custom Wrap official requirements

Research snapshot: **2026-08-09**
Scope: Tesla primary sources only. The principal source is Tesla's public `teslamotors/custom-wraps` repository, pinned here to commit [`86c7d31454caf0f20af6f6af105f577643f13bce`](https://github.com/teslamotors/custom-wraps/tree/86c7d31454caf0f20af6f6af105f577643f13bce). Current Tesla Owner's Manual pages are used only to corroborate in-vehicle Paint Shop availability and Tesla's own availability caveat.

## Executive conclusion

WrapForge can make a defensible compatibility claim only at the **official template-variant** level. Tesla currently publishes 12 distinct template variants covering Cybertruck, Model 3, Model Y, Model S, and Model X. It does **not** publish an exhaustive region/VIN/configuration matrix or a minimum vehicle-firmware version. Consequently, “official template available” must not be presented as “guaranteed available on this owner's vehicle.” Tesla explicitly says entertainment options may vary by market region, manufacture date, and vehicle configuration in its [Ireland Model 3 manual](https://www.tesla.com/ownersmanual/model3/en_ie/GUID-79A49D40-A028-435B-A7F6-8E48846AB9E9.html) and [Ireland Model Y manual](https://www.tesla.com/ownersmanual/modely/en_ie/GUID-79A49D40-A028-435B-A7F6-8E48846AB9E9.html).

This Paint Shop feature changes the vehicle's **3D on-screen visualization**. It is distinct from Tesla's separately documented, physically installed [Tesla Vinyl Wraps service](https://www.tesla.com/support/shop/tesla-vinyl-wrap); WrapForge naming and help copy should not conflate the two.

## Official template inventory

Tesla's current [vehicle selector](https://github.com/teslamotors/custom-wraps/blob/86c7d31454caf0f20af6f6af105f577643f13bce/README.md#select-your-vehicle) lists these variants:

| Catalog key | Tesla's displayed vehicle/variant | Official template | Template pixels observed at pinned commit | Compatibility certainty |
| --- | --- | --- | ---: | --- |
| `cybertruck` | Cybertruck | [directory](https://github.com/teslamotors/custom-wraps/tree/86c7d31454caf0f20af6f6af105f577643f13bce/cybertruck) | 1024×768 | Variant name is explicit; no model-year qualifier. |
| `model3` | Model 3 | [directory](https://github.com/teslamotors/custom-wraps/tree/86c7d31454caf0f20af6f6af105f577643f13bce/model3) | 1024×1024 | Legacy/generic entry; Tesla gives no year or trim boundary. |
| `model3-2024-base` | Model 3 (2024+) Standard & Premium | [directory](https://github.com/teslamotors/custom-wraps/tree/86c7d31454caf0f20af6f6af105f577643f13bce/model3-2024-base) | 1024×1024 | Explicit year and trim grouping. |
| `model3-2024-performance` | Model 3 (2024+) Performance | [directory](https://github.com/teslamotors/custom-wraps/tree/86c7d31454caf0f20af6f6af105f577643f13bce/model3-2024-performance) | 1024×1024 | Explicit year and trim grouping. |
| `modely` | Model Y | [directory](https://github.com/teslamotors/custom-wraps/tree/86c7d31454caf0f20af6f6af105f577643f13bce/modely) | 1024×1024 | Legacy/generic entry; Tesla gives no year or trim boundary. |
| `modely-2025-base` | Model Y (2025+) Standard | [directory](https://github.com/teslamotors/custom-wraps/tree/86c7d31454caf0f20af6f6af105f577643f13bce/modely-2025-base) | 1024×1024 | Explicit year and trim. |
| `modely-2025-premium` | Model Y (2025+) Premium | [directory](https://github.com/teslamotors/custom-wraps/tree/86c7d31454caf0f20af6f6af105f577643f13bce/modely-2025-premium) | 1024×1024 | Explicit year and trim. |
| `modely-2025-performance` | Model Y (2025+) Performance | [directory](https://github.com/teslamotors/custom-wraps/tree/86c7d31454caf0f20af6f6af105f577643f13bce/modely-2025-performance) | 1024×1024 | Explicit year and trim. |
| `modely-l` | Model Y L | [directory](https://github.com/teslamotors/custom-wraps/tree/86c7d31454caf0f20af6f6af105f577643f13bce/modely-l) | 1024×1024 | Variant name is explicit; no year qualifier. |
| `models-2021` | Model S (2021+) | [directory](https://github.com/teslamotors/custom-wraps/tree/86c7d31454caf0f20af6f6af105f577643f13bce/models-2021) | 1024×1024 | Explicit minimum model year; trim boundary is not stated. |
| `models-2025-plaid` | Model S (2025+) Plaid | [directory](https://github.com/teslamotors/custom-wraps/tree/86c7d31454caf0f20af6f6af105f577643f13bce/models-2025-plaid) | 1024×1024 | Explicit year and trim. |
| `modelx-2021` | Model X (2021+) | [directory](https://github.com/teslamotors/custom-wraps/tree/86c7d31454caf0f20af6f6af105f577643f13bce/modelx-2021) | 1024×1024 | Explicit minimum model year; trim boundary is not stated. |

The observed pixel dimensions come from the official PNG binaries at the pinned commit. Tesla's current top-level instructions say to use the template size “for best results”; they do not say every uploaded file must exactly match it. Cybertruck is a documented exception to any square-only interpretation: Tesla's original Cybertruck instructions required exactly **1024×768**, and the current official Cybertruck template remains 1024×768 ([original official README](https://github.com/teslamotors/custom-wraps/blob/ea60cdb7d41eae27b83c0d04b9a573cb9d0d1012/README.md#image-requirements), [current template](https://github.com/teslamotors/custom-wraps/blob/86c7d31454caf0f20af6f6af105f577643f13bce/cybertruck/template.png)).

## File acceptance and template rules

Tesla's current [image requirements](https://github.com/teslamotors/custom-wraps/blob/86c7d31454caf0f20af6f6af105f577643f13bce/README.md#image-requirements) state:

- PNG format only.
- Resolution “512x512 to 1024x1024 pixels,” with the official template size recommended for best results.
- Maximum file size: 1 MB.
- Filename: alphanumeric characters, underscores, dashes, and spaces only; maximum 30 characters.
- Capacity: up to 10 wraps transferred from the mobile app **and** up to 10 from USB.
- Creation rule: download the template for the specific vehicle, edit it by filling the white areas, and save the result as a PNG. The model-specific READMEs repeat that workflow; for example, [Model 3 (2024+) Standard & Premium](https://github.com/teslamotors/custom-wraps/blob/86c7d31454caf0f20af6f6af105f577643f13bce/model3-2024-base/README.md).

Important ambiguities for validation:

- The generalized “512x512 to 1024x1024” wording looks square, but the official Cybertruck asset is 1024×768. Do not impose a universal 1:1 aspect ratio. The safest publish-ready output is the exact dimensions of the selected official template; treat other in-range dimensions as “format-valid but not template-verified.”
- Tesla does not define whether “1 MB” means 1,000,000 or 1,048,576 bytes. A third-party preflight can use the stricter 1,000,000-byte ceiling, but must label that as WrapForge's conservative policy, not an exact Tesla definition.
- Tesla does not clarify whether the 30-character limit includes `.png`, whether “alphanumeric” is ASCII-only, or whether filename comparison is case-sensitive. Preserve the original name, show the measured length, and offer a conservative ASCII-safe generated name rather than claiming certainty.
- Tesla publishes no requirement for PNG color type, bit depth, color profile, alpha/transparency, metadata, or compression method. WrapForge should decode and safety-check uploads, but must not call its own normalization choices Tesla requirements.
- A valid PNG carries no official vehicle-variant identifier. Compatibility therefore depends on catalog metadata plus use of the matching template; it cannot be proven from MIME type, dimensions, or filename alone.

## Transfer and apply workflows

### Mobile app

Tesla's current instructions require **Tesla app v4.59.0 or later** and give the path **Creations → Wrap → Upload**. After transfer, the wrap appears in the vehicle at **Toybox → Paint Shop → Wraps**, where it is applied ([official workflow](https://github.com/teslamotors/custom-wraps/blob/86c7d31454caf0f20af6f6af105f577643f13bce/README.md#how-to-use-custom-wraps), [official July 2026 mobile-upload change](https://github.com/teslamotors/custom-wraps/commit/86c7d31454caf0f20af6f6af105f577643f13bce)).

For a WrapForge download, the officially supportable instruction is therefore: download/save the compatible PNG to a location the phone can select, then manually open the Tesla app and use **Creations → Wrap → Upload**. Tesla's public instructions do not document a web deep link, share-sheet contract, third-party API, automatic import, phone storage location, upload progress/error contract, or whether an added driver can upload. WrapForge must not promise one-tap import or silently transfer a file to a Tesla account.

### USB fallback

Tesla instructs users to format a USB drive as exFAT, FAT32, MS-DOS FAT, ext3, or ext4; NTFS is unsupported. A root-level folder named exactly `Wraps` must contain the PNG files, and the drive must not contain map or firmware updates. The vehicle path remains **Toybox → Paint Shop → Wraps** ([official USB setup](https://github.com/teslamotors/custom-wraps/blob/86c7d31454caf0f20af6f6af105f577643f13bce/README.md#usb-drive-setup)).

The current repository does not specify which physical USB port to use. Current Ireland manuals note generally that, on some vehicles made after approximately 1 November 2021, center-console USB ports are charge-only and the glovebox port must be used; however that note is presented in broader Toybox/controller context, not as a Custom Wrap-specific instruction ([Model 3 manual](https://www.tesla.com/ownersmanual/model3/en_ie/GUID-79A49D40-A028-435B-A7F6-8E48846AB9E9.html), [Model Y manual](https://www.tesla.com/ownersmanual/modely/en_ie/GUID-79A49D40-A028-435B-A7F6-8E48846AB9E9.html)). WrapForge may repeat it as troubleshooting guidance, not as a universal port rule.

## Software and regional support

| Dimension | What Tesla officially establishes | What remains unknown |
| --- | --- | --- |
| Tesla mobile app | v4.59.0 or later for mobile upload ([source](https://github.com/teslamotors/custom-wraps/blob/86c7d31454caf0f20af6f6af105f577643f13bce/README.md#how-to-use-custom-wraps)). | Whether mobile upload is enabled for every account role, region, and listed vehicle at that app version. |
| Vehicle software | Current official owner manuals document Paint Shop and custom-wrap loading for [Model 3](https://www.tesla.com/ownersmanual/model3/en_ie/GUID-79A49D40-A028-435B-A7F6-8E48846AB9E9.html), [Model Y](https://www.tesla.com/ownersmanual/modely/en_ie/GUID-79A49D40-A028-435B-A7F6-8E48846AB9E9.html), [Model S](https://www.tesla.com/ownersmanual/models/en_ie/GUID-79A49D40-A028-435B-A7F6-8E48846AB9E9.html), and [Model X](https://www.tesla.com/ownersmanual/modelx/en_ie/GUID-79A49D40-A028-435B-A7F6-8E48846AB9E9.html); Tesla also publishes a Cybertruck template. | No minimum vehicle-firmware build is stated in the current custom-wrap repository or the reviewed owner-manual pages. Claims such as a specific `2025.x` minimum cannot be verified from these official sources. |
| Regions | The official repository has no region restriction, and Tesla publishes Paint Shop/custom-wrap text in Ireland-localized manuals. | Tesla publishes no exhaustive country rollout matrix. Its manuals explicitly warn entertainment options may vary by market region, manufacture date, and configuration. |

“Latest vehicle software” is the only safe user guidance until Tesla publishes a minimum build. It must not be represented as a verified numeric compatibility threshold.

## Catalog policy implied by the evidence

1. Model compatibility as `official-template-listed`, `owner-confirmed`, or `unknown`; never as a single unsupported boolean.
2. Store Tesla's exact display name, repository key, pinned template commit, observed dimensions, and the date last verified.
3. Require creators to select one exact template variant. Do not merge generic Model 3/Model Y entries with their refreshed Performance/Base/Premium variants.
4. For generic `model3` and `modely`, display “Tesla does not specify the year/trim boundary in its template catalog”; do not invent a cutoff from body style or marketing names.
5. Show mobile upload as requiring app v4.59.0+, but show vehicle/region availability as “check Paint Shop on your vehicle.”
6. Keep USB instructions available as the documented fallback.
7. Validate the published constraints, but surface the resolution, MB, and filename ambiguities above rather than claiming more precision than Tesla provides.
8. Do not imply that the on-screen visualization represents a physical vinyl wrap. Tesla describes this feature as customization of the vehicle's **3D visualization** in Paint Shop ([source](https://github.com/teslamotors/custom-wraps/blob/86c7d31454caf0f20af6f6af105f577643f13bce/README.md#custom-wrap-images-for-tesla-vehicles)).
9. Do not imply affiliation, approval, or automatic Tesla-account integration.
10. The official repository contains no `LICENSE` file at the pinned snapshot ([repository tree](https://github.com/teslamotors/custom-wraps/tree/86c7d31454caf0f20af6f6af105f577643f13bce)). Public downloadability is not itself a redistribution licence; link to Tesla's originals or obtain legal review before mirroring templates/examples.

## Open uncertainties to re-check before launch

- Minimum Tesla vehicle firmware for each template variant.
- Country/account rollout matrix for mobile upload and in-car Paint Shop wraps.
- Whether primary/additional drivers have different mobile-upload permissions.
- Formal interpretation of the dimension range, particularly non-Cybertruck non-square PNGs.
- Byte definition of 1 MB and whether `.png` counts toward the 30-character filename limit.
- Exact production-year/trim mapping for Tesla's generic `model3`, `modely`, `cybertruck`, and `modely-l` entries.
- Licence/permission for redistributing Tesla templates and examples.

Until Tesla resolves these, WrapForge should describe files as **built from Tesla's published template for the selected variant**, not as universally “Tesla-certified” or guaranteed to import.

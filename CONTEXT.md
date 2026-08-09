# WrapForge

WrapForge is a community for distributing compatible Custom Wrap files for Tesla Paint Shop. Its core loop is Upload, Discover, Download, and Use.

## Language

**Custom Wrap**:
A PNG artwork file made from Tesla's published template and applied to the vehicle's 3D visualization in Paint Shop.
_Avoid_: Vinyl wrap, physical wrap, skin

**Vehicle Model**:
One of the broad Tesla model families used to browse the catalog, such as Model 3 or Model Y.
_Avoid_: Vehicle Variant, template

**Template Variant**:
One exact, versioned vehicle entry in Tesla's official Custom Wrap template catalog. It is the compatibility unit selected when publishing a Custom Wrap.
_Avoid_: Trim, generic model, template version

**Active Template Variant**:
The current verified revision of a Template Variant that a Creator may select for a new Wrap.
_Avoid_: Supported vehicle, current model

**Legacy Template Variant**:
An immutable former revision retained for existing Wraps but unavailable for new publication.
_Avoid_: Unsupported vehicle, deleted variant

**Compatibility Claim**:
The evidence-backed statement that a Custom Wrap was built for a particular Template Variant. It does not guarantee Paint Shop availability for every vehicle, account, firmware version, or region.
_Avoid_: Tesla-certified, universally compatible, guaranteed compatible

**Format-valid Wrap Asset**:
A safely decodable PNG that satisfies WrapForge's conservative file constraints but has not established publishable Template Variant compatibility.
_Avoid_: Compatible wrap, verified wrap

**Template-verified Wrap Asset**:
A Format-valid Wrap Asset whose dimensions exactly match its selected Template Variant and whose Creator confirms that variant was used. This does not prove visual alignment or Tesla acceptance.
_Avoid_: Tesla-verified, certified wrap, guaranteed import

**Wrap**:
The community record that describes, publishes, and tracks one Custom Wrap and its assets.
_Avoid_: Design, post, listing

**Wrap Asset**:
An original downloadable Custom Wrap or a derived preview or thumbnail belonging to a Wrap.
_Avoid_: File, image

**Pending Upload**:
A short-lived Creator-owned workflow that may produce a new immutable Asset Revision after authoritative validation.
_Avoid_: Draft Wrap, temporary file

**Staged Upload**:
The untrusted raw bytes held privately while a Pending Upload is validated; it is not yet a Wrap Asset.
_Avoid_: Original Wrap Asset, uploaded wrap

**Asset Revision**:
An immutable set containing one Original Wrap Asset and its derived display assets for a Wrap at a point in time.
_Avoid_: Overwritten file, asset version

**Original Wrap Asset**:
The normalized, Template-verified PNG delivered when a User or Guest Session downloads a Published Wrap.
_Avoid_: Staged Upload, preview image

**Derived Wrap Asset**:
A non-downloadable web preview or thumbnail produced from an Original Wrap Asset.
_Avoid_: Original Wrap Asset, source file

**Creator**:
A User who has published at least one Wrap at any time. Creator identity persists even when no Wrap is currently Published; no separate creator account type exists.
_Avoid_: Seller, artist account

**User**:
A registered community member who may interact with Wraps and becomes a Creator by publishing one.
_Avoid_: Account, customer

**Profile**:
The public identity and attribution record for a User, addressed by a unique Username.
_Avoid_: Account, creator page

**Username**:
The case-insensitive canonical handle used in a Profile URL and community attribution.
_Avoid_: Display name, user ID

**Username Alias**:
A permanently reserved former Username that redirects to the same Profile after a rename.
_Avoid_: Recycled username, nickname

**Like**:
A public endorsement by one User of another Creator's Wrap.
_Avoid_: Favorite, reaction

**Favorite**:
A private bookmark that only its owning User may list, while its aggregate may contribute to Trending.
_Avoid_: Like, collection

**Follow**:
A User's subscription to a Creator's identity; P0 does not imply a personalized feed or notifications.
_Avoid_: Friend, subscription plan

**Comment**:
A plain-text contribution by a User on a Published Wrap.
_Avoid_: Reply, review, message

**Report**:
A User's private request for an administrator to review a Wrap, Comment, or User against a canonical reason.
_Avoid_: Complaint, moderation action

**Moderation Action**:
An auditable administrator decision that changes the visibility or participation state of a Report target.
_Avoid_: Report, edit

**Suspended User**:
A User temporarily barred from authenticated community actions whose public Profile, Wraps, Comments, and social influence are excluded until reinstatement.
_Avoid_: Deleted user, banned content

**Deactivated User**:
A User whose access and public identity have been withdrawn while minimum non-public records required for safety, integrity, and legal obligations are retained.
_Avoid_: Suspended user, hard-deleted user

**Guest Session**:
An anonymous browser session used to limit duplicate public Download Events without storing a raw IP address.
_Avoid_: Anonymous user, visitor account

**Download Event**:
A record that WrapForge successfully granted access to a Published Wrap's Original Wrap Asset. It records whether the grant opened the public count or was a duplicate within the deduplication window.
_Avoid_: Completed transfer, click, page view

**Counted Download**:
A Download Event that opened the ten-minute deduplication gate and incremented a Wrap's public download count.
_Avoid_: Download request, duplicate download

**Discovery Set**:
The single visibility-filtered set of Published Wraps eligible to appear on every public browse, search, Trending, Model, and Profile surface.
_Avoid_: Search index, feed, gallery data

**Trending Score**:
A reproducible, time-decayed ranking value calculated only from eligible recent engagement within the Discovery Set.
_Avoid_: Recommendation, popularity count

**First Published At**:
The immutable time a Wrap first entered the Discovery Set. Republishing or replacing an Asset Revision does not reset it.
_Avoid_: Updated at, latest publish time

**Wrap Slug**:
The permanent, globally unique public URL handle assigned to a Wrap and never reassigned to another Wrap.
_Avoid_: Title, storage key, mutable slug

**Published Wrap**:
A Wrap that is publicly discoverable and whose original Wrap Asset is eligible for download.
_Avoid_: Public draft, active wrap

**Hidden Wrap**:
A Wrap made non-public by moderation while its record and evidence remain retained.
_Avoid_: Deleted wrap, unpublished wrap

**Removed Wrap**:
A soft-deleted Wrap that is no longer available to its Creator or the public through normal product flows.
_Avoid_: Hard-deleted wrap, hidden wrap

**Hidden Comment**:
A Comment made non-public by moderation while its text and evidence remain available to administrators.
_Avoid_: Deleted comment, removed comment

**Removed Comment**:
A soft-deleted Comment whose public text is no longer available through normal product flows.
_Avoid_: Hidden comment, hard-deleted comment

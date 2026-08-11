# @shortdrama-router/provider-xiaoyunque

XiaoYunque adapter for `shortdrama-router`.

Credential priority is official Access Key first, then a user-authorized local Web session. Credentials come from an injected credential source; the package does not send them to a remote router or persist them by default.

For the default interactive flow, call `beginAuthorization("api_key")`, open the returned official login URL in a host-managed local browser, and return only the requested cookies with the exact `cookie_origin`. `completeAuthorization(...)` uses that temporary session to create an Access Key through XiaoYunque's Web API, saves the AK with `setAccessKey`, and discards the cookies. Users do not need to locate or paste an AK. The default lifetime is 30 days; `accessKeyEnrollment.lifetimeDays` accepts `7`, `30`, `90`, or `365`.

Starting authorization again replaces the previous pending request, so a user can safely retry after closing or losing the login page. Only the latest `authorization_id` can be completed.

Use `browser_session` only when a caller explicitly needs Web-only capabilities. In that mode the injected credential source must implement `setWebSession` and is responsible for secure local storage.

Image generation uses the official Access Key API and XiaoYunque Nest Agent. It supports text-to-image, provider asset references, aspect ratio, output count, and the documented Seedream/Nova model catalog. Video generation supports text-to-video and references that already have XiaoYunque/Pippit provider asset identities.

`xiaoyunque/seed-audio-1.0` maps to the dedicated Seed Audio canvas workflow for voice, sound effects, and music design. Because this workflow is not exposed through the XiaoYunque Access Key surface, it requires a user-authorized local `browser_session`; the model advertises that requirement in its capabilities. Audio jobs are asynchronous and can use up to three audio references or one image reference. Provider-scoped model discovery and authorization inspection are available without a global model catalog.

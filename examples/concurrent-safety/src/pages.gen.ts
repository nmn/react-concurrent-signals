// Generated route typing for Waku static pages.
import type { GetConfigResponse, PathsForPages } from "waku/router";

import type { getConfig as File_Docs_getConfig } from "./pages/docs";
import type { getConfig as File_Index_getConfig } from "./pages/index";

type Page =
  | ({ path: "/docs" } & GetConfigResponse<typeof File_Docs_getConfig>)
  | ({ path: "/" } & GetConfigResponse<typeof File_Index_getConfig>);

declare module "waku/router" {
  interface RouteConfig {
    paths: PathsForPages<Page>;
  }
  interface CreatePagesConfig {
    pages: Page;
  }
}

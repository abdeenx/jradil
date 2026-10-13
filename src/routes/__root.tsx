import { HeadContent, Scripts, createRootRoute } from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import { TanStackDevtools } from "@tanstack/react-devtools";

import { DESCRIPTION_AR, TITLE_AR } from "#/lib/config.ts";
import { THEME_INIT_SCRIPT } from "#/lib/theme.ts";

import appCss from "../styles.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: TITLE_AR },
      { name: "description", content: DESCRIPTION_AR },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      // The ICO first for old browsers, then the SVG they will prefer if they
      // can read it, and a flat PNG for iOS home screens.
      { rel: "icon", href: "/favicon.ico", sizes: "32x32" },
      { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png", sizes: "180x180" },
    ],
  }),
  shellComponent: RootDocument,
});

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    // The whole interface is Modern Standard Arabic, laid out right to left.
    <html lang="ar" dir="rtl">
      <head>
        <HeadContent />
        {/*
          Runs before the first paint so a dark-mode visitor never sees a white
          flash. Inline on purpose: a separate request would be too late.
        */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="bg-base-200 text-base-content min-h-screen">
        {children}
        <TanStackDevtools
          config={{
            position: "bottom-right",
          }}
          plugins={[
            {
              name: "Tanstack Router",
              render: <TanStackRouterDevtoolsPanel />,
            },
          ]}
        />
        <Scripts />
      </body>
    </html>
  );
}

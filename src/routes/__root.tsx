import { HeadContent, Scripts, createRootRoute } from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import { TanStackDevtools } from "@tanstack/react-devtools";

import { APP_NAME_AR } from "#/lib/config.ts";
import { THEME_INIT_SCRIPT } from "#/lib/theme.ts";

import appCss from "../styles.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: `${APP_NAME_AR} — كلمة اليوم` },
      {
        name: "description",
        content:
          "لعبة كلمة اليوم باللهجة السودانية: خمسة حروف، ست محاولات، وكلمة جديدة كل يوم عند منتصف الليل بتوقيت السودان.",
      },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
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

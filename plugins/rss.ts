import { $XML, stringify } from "../deps/xml.ts";
import { Page } from "../core/filesystem.ts";
import { Search } from "../plugins/search.ts";

import type { Data, Site } from "../core.ts";

export interface Options {
  filename: string;
  query: string;
  sort: string;
  title: string;
  buildDate: Date;
  description: string;
  language: string;
  generator: string;
}

export const defaults: Options = {
  filename: "/feed.rss",
  query: "",
  sort: "url=asc",
  title: "My RSS Feed",
  buildDate: new Date(),
  description: "",
  language: "en",
  generator: "https://lume.land",
};

export default (userOptions?: Partial<Options>) => {
  const options = {
    ...defaults,
    ...userOptions,
  };

  return (site: Site) => {
    site.addEventListener("afterRender", () => {
      const feed = Page.create(options.filename, getFeedContent(site));
      site.pages.push(feed);
    });

    const getFeedContent = (site: Site) => {
      const search = new Search(site, true);
      const pages = search.pages(options.query, options.sort);
      const items = pages.map((page: Data) => ({
        title: page.title,
        link: site.url(page.url, true),
        guid: {
          "@isPermaLink": false,
          "#text": site.url(page.url, true),
        },
        description: page.excerpt,
        "content:encoded": {
          "#text": page.content,
        },
        pubDate: page.date?.toUTCString(),
      }));
      const feed = {
        [$XML]: { cdata: [["rss", "channel", "item", "content:encoded"]] },
        xml: {
          "@version": "1.0",
          "@encoding": "UTF-8",
        },
        rss: {
          "@xmlns:content": "http://purl.org/rss/1.0/modules/content/",
          "@xmlns:wfw": "http://wellformedweb.org/CommentAPI/",
          "@xmlns:dc": "http://purl.org/dc/elements/1.1/",
          "@xmlns:atom": "http://www.w3.org/2005/Atom",
          "@xmlns:sy": "http://purl.org/rss/1.0/modules/syndication/",
          "@xmlns:slash": "http://purl.org/rss/1.0/modules/slash/",
          "@version": "2.0",
          channel: {
            title: options.title,
            link: site.url("", true),
            "atom:link": {
              "@href": site.url(options.filename, true),
              "@rel": "self",
              "@type": "application/rss+xml",
            },
            description: options.description,
            lastBuildDate: options.buildDate.toUTCString(),
            language: options.language,
            generator: options.generator,
            item: items,
          },
        },
      };
      return stringify(feed);
    };
  };
};

"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import type { CatalogModel } from "@/lib/catalog";
import type { DiscoveryQuery } from "@/lib/discovery-query";

export function DiscoveryFilters({
  catalog,
  query,
}: {
  catalog: CatalogModel[];
  query: DiscoveryQuery;
}) {
  const [model, setModel] = useState(query.model ?? "");
  const [variant, setVariant] = useState(query.variant ?? "");
  const variants = useMemo(
    () =>
      model
        ? (catalog.find((item) => item.slug === model)?.variants ?? [])
        : catalog.flatMap((item) => item.variants),
    [catalog, model],
  );

  return (
    <form className="discovery-filters" action="/explore" method="get">
      <label>
        Search
        <input
          name="q"
          defaultValue={query.q}
          maxLength={100}
          placeholder="Title, tags, or creator"
        />
      </label>
      <label>
        Vehicle Model
        <select
          name="model"
          value={model}
          onChange={(event) => {
            const nextModel = event.target.value;
            setModel(nextModel);
            if (
              variant &&
              !catalog
                .find((item) => item.slug === nextModel)
                ?.variants.some((item) => item.key === variant)
            ) {
              setVariant("");
            }
          }}
        >
          <option value="">All models</option>
          {catalog.map((item) => (
            <option key={item.slug} value={item.slug}>
              {item.displayName}
            </option>
          ))}
        </select>
      </label>
      <label>
        Template Variant
        <select
          name="variant"
          value={variant}
          onChange={(event) => setVariant(event.target.value)}
        >
          <option value="">All variants</option>
          {variants.map((item) => (
            <option key={item.key} value={item.key}>
              {item.displayName}
            </option>
          ))}
        </select>
      </label>
      <label>
        Sort
        <select name="sort" defaultValue={query.sort}>
          <option value="NEWEST">Newest</option>
          <option value="TRENDING">Trending</option>
          <option value="MOST_DOWNLOADED">Most downloaded</option>
        </select>
      </label>
      <div className="discovery-filter-actions">
        <button className="button" type="submit">
          Apply filters
        </button>
        <Link className="text-link" href="/explore">
          Clear filters
        </Link>
      </div>
    </form>
  );
}

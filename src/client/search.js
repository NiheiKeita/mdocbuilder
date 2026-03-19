const siteConfig = window.__SITE_CONFIG__ || { basePath: "/", siteName: "Documents" };

const searchState = {
  indexPromise: null,
  resultsLimit: 8,
};

const searchForm = document.querySelector("[data-search-form]");
const searchInput = document.querySelector("[data-search-input]");
const searchDropdown = document.querySelector("[data-search-dropdown]");
const searchPageRoot = document.querySelector("[data-search-page]");

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function normalizeQuery(query) {
  return query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

function withBase(pathname) {
  const basePath = siteConfig.basePath || "/";
  const normalizedBase = basePath.endsWith("/") ? basePath : `${basePath}/`;
  const normalizedPath = pathname.startsWith("/") ? pathname.slice(1) : pathname;
  return `${normalizedBase}${normalizedPath}`.replace(/\/{2,}/g, "/");
}

function buildExcerpt(doc, terms) {
  const source = doc.plainText || doc.description || "";
  if (!source) {
    return "";
  }

  const lowerSource = source.toLowerCase();
  const firstMatch = terms
    .map((term) => lowerSource.indexOf(term))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0];

  if (firstMatch === undefined) {
    return source.slice(0, 160).trim();
  }

  const start = Math.max(0, firstMatch - 50);
  const end = Math.min(source.length, firstMatch + 110);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < source.length ? "..." : "";
  return `${prefix}${source.slice(start, end).trim()}${suffix}`;
}

function highlightText(text, terms) {
  if (!text) {
    return "";
  }

  let result = escapeHtml(text);
  for (const term of terms) {
    if (!term) {
      continue;
    }
    const pattern = new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
    result = result.replace(pattern, "<mark>$1</mark>");
  }
  return result;
}

function scoreDocument(doc, terms) {
  if (!terms.length) {
    return null;
  }

  const title = doc.title.toLowerCase();
  const path = doc.path.toLowerCase();
  const description = (doc.description || "").toLowerCase();
  const headings = (doc.headings || []).map((heading) => heading.text.toLowerCase()).join(" ");
  const plainText = (doc.plainText || "").toLowerCase();

  let score = 0;

  for (const term of terms) {
    let matched = false;

    if (title.includes(term)) {
      score += 10;
      matched = true;
    }
    if (path.includes(term)) {
      score += 6;
      matched = true;
    }
    if (headings.includes(term)) {
      score += 5;
      matched = true;
    }
    if (description.includes(term)) {
      score += 4;
      matched = true;
    }
    if (plainText.includes(term)) {
      score += 2;
      matched = true;
    }

    if (!matched) {
      return null;
    }
  }

  return score;
}

function formatResult(doc, terms) {
  const excerpt = buildExcerpt(doc, terms);
  return {
    ...doc,
    excerpt,
    highlightedTitle: highlightText(doc.title, terms),
    highlightedPath: highlightText(doc.path, terms),
    highlightedExcerpt: highlightText(excerpt, terms),
    href: withBase(doc.path),
  };
}

async function loadIndex() {
  if (!searchState.indexPromise) {
    searchState.indexPromise = fetch(withBase("/search-index.json"))
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Failed to load search index: ${response.status}`);
        }
        return response.json();
      })
      .then((payload) => payload.documents || []);
  }

  return searchState.indexPromise;
}

async function searchDocuments(rawQuery) {
  const terms = normalizeQuery(rawQuery);
  if (!terms.length) {
    return [];
  }

  const documents = await loadIndex();
  return documents
    .map((doc) => {
      const score = scoreDocument(doc, terms);
      if (score === null) {
        return null;
      }
      return {
        score,
        result: formatResult(doc, terms),
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return new Date(b.result.updatedAt).getTime() - new Date(a.result.updatedAt).getTime();
    })
    .map((entry) => entry.result);
}

function closeDropdown() {
  if (searchDropdown) {
    searchDropdown.hidden = true;
    searchDropdown.innerHTML = "";
  }
}

function renderDropdownError(message) {
  if (!searchDropdown) {
    return;
  }

  searchDropdown.hidden = false;
  searchDropdown.innerHTML = `
    <div class="search-empty">
      <strong>Search unavailable</strong>
      <span>${escapeHtml(message)}</span>
    </div>
  `;
}

function renderDropdown(results, query) {
  if (!searchDropdown) {
    return;
  }

  if (!query.trim()) {
    closeDropdown();
    return;
  }

  if (!results.length) {
    searchDropdown.hidden = false;
    searchDropdown.innerHTML = `
      <div class="search-empty">
        <strong>No results</strong>
        <span>${escapeHtml(query)} に一致するページはまだありません。</span>
      </div>
    `;
    return;
  }

  searchDropdown.hidden = false;
  searchDropdown.innerHTML = results
    .slice(0, searchState.resultsLimit)
    .map(
      (result) => `
        <a class="search-result-card" href="${result.href}">
          <span class="search-result-title">${result.highlightedTitle}</span>
          <span class="search-result-path">${result.highlightedPath}</span>
          <span class="search-result-excerpt">${result.highlightedExcerpt}</span>
        </a>
      `,
    )
    .join("");
}

function renderSearchPage(query, results) {
  if (!searchPageRoot) {
    return;
  }

  const countNode = searchPageRoot.querySelector("[data-search-page-count]");
  const listNode = searchPageRoot.querySelector("[data-search-page-results]");

  if (countNode) {
    countNode.textContent = query.trim()
      ? `${results.length} results for "${query.trim()}"`
      : "Type in the search box to find documents.";
  }

  if (!listNode) {
    return;
  }

  if (!query.trim()) {
    listNode.innerHTML = `
      <div class="empty-state">
        <h2>Search the docs</h2>
        <p>タイトル、URL、見出し、本文から絞り込めます。</p>
      </div>
    `;
    return;
  }

  if (!results.length) {
    listNode.innerHTML = `
      <div class="empty-state">
        <h2>No matches</h2>
        <p>${escapeHtml(query.trim())} に一致するドキュメントは見つかりませんでした。</p>
      </div>
    `;
    return;
  }

  listNode.innerHTML = results
    .map(
      (result) => `
        <a class="search-page-card" href="${result.href}">
          <span class="search-page-title">${result.highlightedTitle}</span>
          <span class="search-page-path">${result.highlightedPath}</span>
          <span class="search-page-excerpt">${result.highlightedExcerpt}</span>
        </a>
      `,
    )
    .join("");
}

async function updateSearch(query, { dropdown = false, searchPage = false } = {}) {
  const results = await searchDocuments(query);
  if (dropdown) {
    renderDropdown(results, query);
  }
  if (searchPage) {
    renderSearchPage(query, results);
  }
}

if (searchForm && searchInput) {
  searchForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const query = searchInput.value.trim();
    const url = new URL(withBase("/search/"), window.location.origin);
    if (query) {
      url.searchParams.set("q", query);
    }
    window.location.href = url.toString();
  });

  searchInput.addEventListener("input", async () => {
    try {
      await updateSearch(searchInput.value, { dropdown: true });
    } catch (error) {
      renderDropdownError(error.message);
    }
  });

  searchInput.addEventListener("focus", async () => {
    if (searchInput.value.trim()) {
      try {
        await updateSearch(searchInput.value, { dropdown: true });
      } catch (error) {
        renderDropdownError(error.message);
      }
    }
  });

  document.addEventListener("click", (event) => {
    if (!searchForm.contains(event.target)) {
      closeDropdown();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeDropdown();
    }
  });
}

if (searchPageRoot) {
  const searchParams = new URLSearchParams(window.location.search);
  const query = searchParams.get("q") || "";
  if (searchInput) {
    searchInput.value = query;
  }
  updateSearch(query, { searchPage: true }).catch((error) => {
    const listNode = searchPageRoot.querySelector("[data-search-page-results]");
    if (listNode) {
      listNode.innerHTML = `
        <div class="empty-state">
          <h2>Search is unavailable</h2>
          <p>${escapeHtml(error.message)}</p>
        </div>
      `;
    }
  });
}

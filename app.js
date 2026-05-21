/**
 * 散文二次创作成果浏览器 — 核心引擎
 * 负责：数据加载 / 筛选 / 目录渲染 / 阅读区渲染 / Markdown 解析
 */

document.addEventListener("DOMContentLoaded", () => {

    /* ── 数据检查 ── */
    if (typeof ESSAY_DATABASE === "undefined") {
        document.getElementById("stats-summary").textContent = "数据加载失败";
        return;
    }

    const essays = ESSAY_DATABASE;
    let filtered = [...essays];
    let activeIndex = null;
    let activeTab = "version-c";

    /* ── DOM 引用 ── */
    const searchInput      = document.getElementById("search-input");
    const dimensionSelect  = document.getElementById("dimension-select");
    const skeletonSelect   = document.getElementById("skeleton-select");
    const essayList        = document.getElementById("essay-list");
    const statsSummary     = document.getElementById("stats-summary");
    const tagBtns          = document.querySelectorAll(".tag-btn");

    const welcomeScreen    = document.getElementById("welcome-screen");
    const articleViewer    = document.getElementById("article-viewer");

    const articleTitle     = document.getElementById("article-title");
    const articleDimension = document.getElementById("article-dimension");
    const articleSkeleton  = document.getElementById("article-skeleton");
    const articleScore     = document.getElementById("article-score");
    const articleExit      = document.getElementById("article-exit");
    const materialBox      = document.getElementById("article-original-material-box");
    const materialLabel    = document.getElementById("material-label");
    const materialPoem     = document.getElementById("material-poem-body");
    const articleBody      = document.getElementById("article-body");
    const tabBtns          = document.querySelectorAll(".tab-btn");

    const stampsCard       = document.getElementById("stamps-card");
    const stampsFlex       = document.getElementById("stamps-flex");
    const processSections  = document.getElementById("process-sections");

    /* ══════════════════════════════════
       初始化筛选下拉
       ══════════════════════════════════ */
    function initFilters() {
        const dims  = new Set();
        const skels = new Set();
        essays.forEach(e => {
            if (e.dimension) dims.add(e.dimension.trim());
            if (e.skeleton)  skels.add(e.skeleton.trim());
        });
        [...dims].sort().forEach(d => {
            const o = document.createElement("option");
            o.value = d; o.textContent = d;
            dimensionSelect.appendChild(o);
        });
        [...skels].sort().forEach(s => {
            const o = document.createElement("option");
            o.value = s; o.textContent = s;
            skeletonSelect.appendChild(o);
        });
    }

    /* ══════════════════════════════════
       工具：提取诗词片段（侧边卡预览）
       ══════════════════════════════════ */
    function extractVersePreview(text) {
        if (!text) return "";
        const verses = text.split("\n")
            .filter(l => l.trim().startsWith(">"))
            .map(l => l.trim().slice(1).trim().replace(/[*#`_]/g, "").trim())
            .filter(l => l && !isMetaLine(l));
        if (verses.length > 0) return verses.slice(0, 2).join(" / ");
        return "";
    }

    /* ══════════════════════════════════
       工具：提取完整诗词正文（阅读区）
       ══════════════════════════════════ */
    function extractFullPoem(text) {
        if (!text) return "";
        const lines = text.split("\n");

        /* 只匹配真正的诗词原文章节标题，排除「素材类型判定」等分析段 */
        const HEADING_RX = /^##\s+(素材原文|原始诗词|原作素材|原作诗词|原文诗词|原文$|原诗$)/;
        let startIdx = -1;
        for (let i = 0; i < lines.length; i++) {
            if (HEADING_RX.test(lines[i].trim())) {
                startIdx = i;
                break;
            }
        }

        let collected = [];

        if (startIdx >= 0) {
            for (let i = startIdx + 1; i < lines.length; i++) {
                const l = lines[i].trim();
                if (l.startsWith("##") || l.startsWith("---")) break;
                let clean = l.startsWith(">") ? l.slice(1).trim() : l;
                clean = clean.replace(/[*#`_\-]/g, "").trim();
                if (!clean || isMetaLine(clean)) continue;
                if (lines[i].includes("|")) continue;
                collected.push(clean);
            }
        }

        /* fallback：收集所有引用行 */
        if (collected.length === 0) {
            lines.filter(l => l.trim().startsWith(">")).forEach(l => {
                const clean = l.trim().slice(1).trim().replace(/[*#`_\-]/g, "");
                if (clean && !isMetaLine(clean)) collected.push(clean);
            });
        }

        return collected.length > 0
            ? collected.join("<br>")
            : "";
    }

    const META_TERMS = [
        "素材来源","素材类型","核心击中","作者：","作者:","诗题：","诗题:",
        "译文","注释","击中点","维度","骨架","出口","来源：","来源:",
        "原诗：","原诗:","创作提示","四问完成","分析姿态","analytical-posture",
        "inbox/","sessions/","_engine/","_system/"
    ];
    function isMetaLine(l) {
        const lo = l.toLowerCase();
        return META_TERMS.some(t => lo.includes(t.toLowerCase()));
    }

    /* ══════════════════════════════════
       工具：从 essay 提取印章关键词
       ══════════════════════════════════ */
    function extractStamps(essay) {
        const pills = [];

        /* 维度 + 子维度 */
        if (essay.sub_dimension) pills.push({ text: essay.sub_dimension, jade: true });

        /* 出口设计 */
        if (essay.exit_design) pills.push({ text: essay.exit_design, jade: false });



        /* 从创作设定中提取技法关键词（#技法/xxx 或 **技法：xxx**） */
        const settings = essay.creative_settings || "";
        const techMatches = settings.match(/#技法\/([^\s`\]）)]+)/g) || [];
        techMatches.slice(0, 3).forEach(m => {
            pills.push({ text: m.replace("#技法/", ""), jade: false });
        });

        /* 从主线中提取创作风格关键词（蒋勋、余秋雨等） */
        const mainl = essay.mainline_determination || "";
        const styleRX = /(蒋勋|余秋雨|余秋雨式|蒋勋式)/g;
        const styleMatches = [...new Set((mainl.match(styleRX) || []))];
        styleMatches.slice(0, 2).forEach(m => pills.push({ text: m + "笔法", jade: false }));

        /* 去重 */
        const seen = new Set();
        return pills.filter(p => {
            const k = p.text.trim();
            if (!k || seen.has(k)) return false;
            seen.add(k);
            return true;
        }).slice(0, 8);
    }

    /* ══════════════════════════════════
       素材框对齐类型检测
       律诗：各行等长 → layout-lushi（每行居中）
       词：各行不等长但均短 → layout-ci（块居中，行左对齐）
       长文：有长行 → layout-prose（左对齐）
       ══════════════════════════════════ */
    function detectPoemLayout(html) {
        const lines = html.split(/<br\s*\/?>/i)
            .map(l => l.replace(/<[^>]+>/g, "").trim())
            .filter(l => l.length > 0);
        if (lines.length === 0) return "layout-prose";

        /* 有超长行（≥30字）→ 长文 */
        if (lines.some(l => l.length >= 30)) return "layout-prose";

        /* 去标点后的核心字数 */
        const PUNCT = /[，。？！、；：""''《》\s…·]/g;
        const coreLens = lines.map(l => l.replace(PUNCT, "").length);
        const minLen = Math.min(...coreLens);
        const maxLen = Math.max(...coreLens);
        const isEqualLen = maxLen - minLen <= 2;

        /* 检测律诗：
           - 各行等长（差≤2）
           - 半行字数（corLen/2）在 4-8 → 上下联合一行格式（七言=14÷2=7，五言=10÷2=5）
           - 或单行制：直接 4-8 字一行 */
        if (isEqualLen) {
            const half = minLen / 2;
            if ((half >= 4 && half <= 8) || (minLen >= 4 && minLen <= 8)) {
                return "layout-lushi";
            }
        }

        /* 其余：词（长短句，整块居中行内左对齐） */
        return "layout-ci";
    }

    /* ══════════════════════════════════
       得分归一化（百分比方便比较）
       ══════════════════════════════════ */
    function parseScore(scoreStr) {
        if (!scoreStr) return null;
        const m = scoreStr.match(/^(\d+)\/(\d+)/);
        if (!m) return null;
        return { num: parseInt(m[1]), den: parseInt(m[2]), pct: parseInt(m[1]) / parseInt(m[2]) };
    }

    function formatScore(scoreStr) {
        const s = parseScore(scoreStr);
        if (!s) return scoreStr || "未评分";
        return `${s.num} / ${s.den}`;
    }

    /* ══════════════════════════════════
       渲染目录卡片
       ══════════════════════════════════ */
    function renderCatalog() {
        essayList.innerHTML = "";

        if (filtered.length === 0) {
            essayList.innerHTML = `<div class="list-empty"><p>未寻得匹配的篇章</p><p>请尝试更换搜索词或清空筛选条件</p></div>`;
            statsSummary.textContent = "0 篇";
            return;
        }

        statsSummary.textContent = `共 ${filtered.length} 篇`;

        filtered.forEach((essay, idx) => {
            const card = document.createElement("div");
            card.className = "essay-card";
            card.setAttribute("role", "listitem");
            if (activeIndex !== null && filtered[activeIndex] === essay) {
                card.classList.add("active");
            }

            const verse     = extractVersePreview(essay.original_text);
            const title     = essay.title || essay.original_title || "无题";
            const author    = essay.author || "佚名";
            const oriTitle  = essay.original_title || "";
            const scoreDisp = formatScore(essay.score);
            const dim       = essay.dimension || "—";
            const skel      = essay.skeleton  || "—";
            const date      = (essay.date || "").replace("2026-", "");

            card.innerHTML = `
                <div class="card-head">
                    <h3 class="card-title">${esc(title)}</h3>
                    <span class="card-score">${esc(scoreDisp)}</span>
                </div>
                <div class="card-source">
                    <div class="card-source-author">${esc(author)}·《${esc(oriTitle)}》</div>
                    ${verse ? `<div class="card-source-verse">${esc(verse)}</div>` : ""}
                </div>
                <div class="card-foot">
                    <div class="card-badges">
                        <span class="card-badge">${esc(dim)}</span>
                        <span class="card-badge">${esc(skel)}</span>
                    </div>
                    <span class="card-date">${esc(date)}</span>
                </div>
            `;

            card.addEventListener("click", () => {
                activeIndex = idx;
                document.querySelectorAll(".essay-card").forEach(c => c.classList.remove("active"));
                card.classList.add("active");
                showEssay(essay);
            });

            essayList.appendChild(card);
        });
    }

    /* ══════════════════════════════════
       筛选逻辑
       ══════════════════════════════════ */
    function applyFilters() {
        const q     = searchInput.value.toLowerCase().trim();
        const dim   = dimensionSelect.value;
        const skel  = skeletonSelect.value;
        const quick = (document.querySelector(".tag-btn.active") || {}).dataset?.filter || "all";

        filtered = essays.filter(e => {
            if (q) {
                const haystack = [
                    e.title, e.original_title, e.author,
                    e.original_text, e.version_c, e.final_prose,
                    e.dimension, e.skeleton, e.sub_dimension
                ].map(s => (s || "").toLowerCase()).join(" ");
                if (!haystack.includes(q)) return false;
            }
            if (dim  && e.dimension !== dim)  return false;
            if (skel && e.skeleton  !== skel) return false;

            if (quick === "high-score") {
                const s = parseScore(e.score);
                if (!s) return false;
                if (s.pct < 0.9) return false;
            } else if (quick === "recent") {
                if (!(e.date || "").startsWith("2026-05")) return false;
            }

            return true;
        });

        activeIndex = null;
        renderCatalog();
    }

    /* 事件绑定 */
    searchInput.addEventListener("input", applyFilters);
    dimensionSelect.addEventListener("change", applyFilters);
    skeletonSelect.addEventListener("change", applyFilters);
    tagBtns.forEach(btn => btn.addEventListener("click", () => {
        tagBtns.forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        applyFilters();
    }));

    /* ══════════════════════════════════
       展示单篇文章
       ══════════════════════════════════ */
    function showEssay(essay) {
        welcomeScreen.style.display = "none";
        articleViewer.style.display = "block";

        /* 头部元数据 */
        articleTitle.textContent = essay.title || essay.original_title || "无题";
        articleDimension.textContent = `维度 · ${essay.dimension || "未指定"}`;
        articleSkeleton.textContent  = `骨架 · ${essay.skeleton  || "未指定"}`;
        articleScore.textContent     = `评分 ${formatScore(essay.score)}`;

        if (essay.exit_design) {
            articleExit.textContent = `出口 · ${essay.exit_design}`;
            articleExit.style.display = "";
        } else {
            articleExit.style.display = "none";
        }

        /* 原作素材 */
        const poemHtml = extractFullPoem(essay.original_text);
        if (poemHtml) {
            materialLabel.textContent = `原作素材 ｜ ${essay.author || "佚名"} · 《${essay.original_title || "无题"}》`;
            materialPoem.innerHTML = poemHtml;
            materialPoem.className = "material-poem-body " + detectPoemLayout(poemHtml);
            materialBox.style.display = "";
        } else {
            materialBox.style.display = "none";
        }

        /* 右侧印章 */
        renderStamps(essay);

        /* 右侧幕后轨迹 */
        renderProcessLogs(essay);

        /* 正文 */
        renderTabContent(essay);
    }

    /* ── 印章卡 ── */
    function renderStamps(essay) {
        const pills = extractStamps(essay);
        if (pills.length === 0) {
            stampsCard.style.display = "none";
            return;
        }
        stampsCard.style.display = "";
        stampsFlex.innerHTML = pills
            .map(p => `<span class="stamp-pill${p.jade ? " is-jade" : ""}">${esc(p.text)}</span>`)
            .join("");
    }

    /* ── 幕后创作轨迹（可折叠四区块） ── */
    const SECTIONS = [
        {
            key: "distillation",
            title: "素材蒸馏",
            getData: e => {
                if (e.material_distillation) return e.material_distillation;
                return "";
            }
        },
        {
            key: "settings",
            title: "创作设定",
            getData: e => e.creative_settings || ""
        },
        {
            key: "mainline",
            title: "主线改写策略",
            getData: e => e.mainline_determination || ""
        },
        {
            key: "assets",
            title: "资产积累",
            getData: e => {
                if (!e.assets) return "";
                const parts = [];
                if (e.assets.reused)    parts.push(`**复用资产**\n${e.assets.reused}`);
                if (e.assets.log_assets) parts.push(`**新增与改写句子**\n${e.assets.log_assets}`);
                return parts.join("\n\n");
            }
        }
    ];

    function renderProcessLogs(essay) {
        processSections.innerHTML = "";

        let hasAny = false;

        SECTIONS.forEach(sec => {
            const content = sec.getData(essay).trim();

            const section = document.createElement("div");
            section.className = "proc-section";
            if (!content) section.classList.add("is-empty");

            const chevronSVG = `<svg class="proc-chevron" viewBox="0 0 12 12" fill="none">
                <polyline points="2,4 6,8 10,4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>`;

            const toggle = document.createElement("div");
            toggle.className = "proc-toggle";
            toggle.innerHTML = `<span class="proc-title">${esc(sec.title)}</span>${chevronSVG}`;

            const body = document.createElement("div");
            body.className = "proc-body";

            if (content) {
                hasAny = true;
                const inner = document.createElement("div");
                inner.className = "proc-content";
                inner.innerHTML = parseMarkdown(content);
                body.appendChild(inner);
            } else {
                const empty = document.createElement("div");
                empty.className = "proc-empty";
                empty.textContent = "本篇暂无此项记录";
                body.appendChild(empty);
            }

            toggle.addEventListener("click", () => {
                section.classList.toggle("is-open");
            });

            section.appendChild(toggle);
            section.appendChild(body);
            processSections.appendChild(section);
        });

        /* 默认展开第一个有内容的区块 */
        const firstFilled = processSections.querySelector(".proc-section:not(.is-empty)");
        if (firstFilled) firstFilled.classList.add("is-open");
    }

    /* ── Tab 内容 ── */
    tabBtns.forEach(btn => {
        btn.addEventListener("click", () => {
            tabBtns.forEach(b => { b.classList.remove("active"); b.setAttribute("aria-selected","false"); });
            btn.classList.add("active");
            btn.setAttribute("aria-selected","true");
            activeTab = btn.dataset.tab;
            if (activeIndex !== null) renderTabContent(filtered[activeIndex]);
        });
    });

    /* ── 正文净化 ──────────────────────────────────────────────────────────
       1. 逐行过滤：模板 blockquote 指令行
       2. 整段删除：过程分析章节（差异重写摘要 / 创作设定 / 拟更新资产 / 出品信息）
       3. 行内清洁：路径引用字符串
       ─────────────────────────────────────────────────────────────────── */
    const BQUOTE_NOISE = [
        /在\s*0[23]_草稿.*基础上/,
        /在\s*0[13]_成稿/,
        /放入此文件/,
        /评分标准详见/,
        /防AI检查标准详见/,
        /style-calibration/,
        /anti-ai-checklist/,
        /_engine\//,
        /_system\//,
        /sessions\//,
        /加工版蒋勋——/,
        /加工版.*——.*保留/,
        /介入点/,
    ];
    /* 非标题行，但触发整段跳过（直到下一个 --- 或 ##/### 为止） */
    const STRIP_BLOCK_STARTS = [
        /^\*\*候选标题/,
        /^候选标题[：:]/,
        /^\*\*最终选定[：:]/,
        /^最终选定[：:]/,
        /^草稿差异操作[：:]/,
        /^\*\*草稿差异操作/,
        /^\*\*16分制/,
        /^\*\*防AI/,
        /^\*\*候选[：:]/,
        /^\*\*选定[：:]/,
        /^\*\*版本说明[：:]/,
    ];
    /* 整段删除的章节标题（##/### 均覆盖，匹配即删到下一个 --- 或 ##/### 为止） */
    const STRIP_SECTIONS = [
        /^#{2,}\s*差异重写摘要/,
        /^#{2,}\s*重写摘要/,
        /^#{2,}\s*创作设定/,
        /^#{2,}\s*出品信息/,
        /^#{2,}\s*拟更新的资产/,
        /^#{2,}\s*对比原版/,
        /^#{2,}\s*16分制/,
        /^#{2,}\s*失败模式/,
        /^#{2,}\s*防AI/,
        /^#{2,}\s*资产沉淀/,
        /^#{2,}\s*结论/,
    ];
    /* 仅删除该行本身（内容保留）的模板标题行 */
    const STRIP_HEADING_ONLY = [
        /^#{2,}\s*成稿\s*$/,
        /^#{2,}\s*正文\s*$/,
        /^#{2,}\s*版本\s*C/,
    ];
    /* 单行删除（不触发块跳过） */
    const STRIP_SINGLE_LINES = [
        /^[☑✅]\s*通过自检/,
        /^通过自检\s*[☑✅]/,
    ];
    /* 行内清洁：把污染字符串替换为空 */
    function cleanInline(line) {
        return line
            .replace(/analytical-posture/g, "")
            .replace(/inbox\/[^\s|）\]，。？！\n]*/g, "")
            .replace(/sessions\/[^\s|）\]，。？！\n]*/g, "");
    }

    function stripTemplateNoise(md) {
        const lines = md.split("\n");
        const out = [];
        let skip = false;   // 正在跳过某个过程章节

        for (let i = 0; i < lines.length; i++) {
            const raw = lines[i];
            const t   = raw.trim();

            /* 仅删该行的模板标题（内容后续保留） */
            if (STRIP_HEADING_ONLY.some(rx => rx.test(t))) continue;

            /* 单行删除 */
            if (STRIP_SINGLE_LINES.some(rx => rx.test(t))) continue;

            /* 进入需跳过的章节（## 标题块 或 非标题块起点） */
            if (STRIP_SECTIONS.some(rx => rx.test(t)) ||
                STRIP_BLOCK_STARTS.some(rx => rx.test(t))) {
                skip = true;
                continue;
            }

            /* 遇到 --- 或其他 ##/### 章节头，结束跳过 */
            if (skip) {
                if (/^---+$/.test(t) || /^#{2,}\s/.test(t)) {
                    skip = false;
                    /* --- 分隔线：跳过，不保留 */
                    if (/^---+$/.test(t)) continue;
                    /* 新章节：重新判断 */
                    if (STRIP_SECTIONS.some(rx => rx.test(t))) { skip = true; continue; }
                    if (STRIP_HEADING_ONLY.some(rx => rx.test(t))) continue;
                    /* 正常章节：fall through */
                } else {
                    continue;
                }
            }

            /* version_c / final_prose 中所有 > 行均为模板指令，全部跳过 */
            if (t.startsWith(">")) continue;

            /* 行内清洁 */
            out.push(cleanInline(raw));
        }

        /* 去掉首尾多余分割线和空行 */
        return out.join("\n")
            .replace(/^(\s*-{3,}\s*\n?)+/, "")   // 开头孤立 ---
            .replace(/(\n\s*---+\s*)+\s*$/, "")   // 结尾孤立 ---
            .trim();
    }

    function renderTabContent(essay) {
        articleBody.style.opacity = "0";
        articleBody.style.transform = "translateY(4px)";

        setTimeout(() => {
            let md = "";
            if (activeTab === "version-c") {
                md = essay.version_c || "_该篇章暂未记录版本 C_";
            } else {
                md = essay.final_prose || "_该篇章暂未记录最终成稿_";
            }
            md = stripTemplateNoise(md);
            articleBody.innerHTML = parseMarkdown(md);
            articleBody.style.opacity = "1";
            articleBody.style.transform = "translateY(0)";
            articleBody.style.transition = "opacity .25s ease, transform .25s ease";
        }, 140);
    }

    /* ══════════════════════════════════
       Markdown 解析器
       ══════════════════════════════════ */
    function parseMarkdown(md) {
        if (!md) return "";

        /* 简单 HTML 转义（仅针对尖括号，保留 & 以支持中文） */
        let html = md.replace(/</g, "&lt;").replace(/>/g, "&gt;");

        /* 把 &gt; 还原为真正的 > 用于 blockquote 检测 */
        html = html.replace(/&gt;/g, ">");

        const lines  = html.split("\n");
        const result = [];
        let inList = false, listType = "";
        let inTable = false, tableHeaders = [], tableRows = [];
        let inBlockquote = false;

        for (let i = 0; i < lines.length; i++) {
            const raw     = lines[i];
            const trimmed = raw.trim();

            /* 关闭表格 */
            if (inTable && (!trimmed.includes("|") || trimmed === "")) {
                result.push(renderTable(tableHeaders, tableRows));
                tableHeaders = []; tableRows = []; inTable = false;
            }

            /* 关闭列表 */
            if (inList && !isListLine(trimmed)) {
                result.push(`</${listType}>`);
                inList = false; listType = "";
            }

            /* 关闭引用 */
            if (inBlockquote && !trimmed.startsWith(">")) {
                result.push("</blockquote>");
                inBlockquote = false;
            }

            /* 表格行 */
            if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
                inTable = true;
                const cells = trimmed.split("|").map(c => c.trim()).filter((_, i, a) => i > 0 && i < a.length - 1);
                if (cells.every(c => /^:?-+:?$/.test(c))) continue;
                if (tableHeaders.length === 0) tableHeaders = cells;
                else tableRows.push(cells);
                continue;
            }

            /* 分隔线 */
            if (/^---+$|^\*\*\*+$/.test(trimmed)) {
                result.push("<hr>");
                continue;
            }

            /* 标题 */
            if (trimmed.startsWith("### ")) { result.push(`<h3>${inl(trimmed.slice(4))}</h3>`); continue; }
            if (trimmed.startsWith("## "))  { result.push(`<h2>${inl(trimmed.slice(3))}</h2>`); continue; }
            if (trimmed.startsWith("# "))   { result.push(`<h1>${inl(trimmed.slice(2))}</h1>`); continue; }

            /* 引用 */
            if (trimmed.startsWith(">")) {
                if (!inBlockquote) { result.push("<blockquote>"); inBlockquote = true; }
                result.push(`<p>${inl(raw.slice(raw.indexOf(">") + 1))}</p>`);
                continue;
            }

            /* 无序列表 */
            if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
                if (!inList) { listType = "ul"; result.push("<ul>"); inList = true; }
                else if (listType !== "ul") { result.push(`</${listType}>`); listType = "ul"; result.push("<ul>"); }
                const item = trimmed.slice(2);
                if      (item.startsWith("[ ] ")) result.push(`<li style="list-style:none"><input type="checkbox" disabled> ${inl(item.slice(4))}</li>`);
                else if (item.startsWith("[x] ") || item.startsWith("[X] ")) result.push(`<li style="list-style:none"><input type="checkbox" checked disabled> ${inl(item.slice(4))}</li>`);
                else result.push(`<li>${inl(item)}</li>`);
                continue;
            }

            /* 有序列表 */
            const olMatch = trimmed.match(/^(\d+)\.\s+(.*)/);
            if (olMatch) {
                if (!inList) { listType = "ol"; result.push("<ol>"); inList = true; }
                else if (listType !== "ol") { result.push(`</${listType}>`); listType = "ol"; result.push("<ol>"); }
                result.push(`<li>${inl(olMatch[2])}</li>`);
                continue;
            }

            /* 空行跳过 */
            if (trimmed === "") continue;

            /* 段落 */
            result.push(`<p>${inl(raw)}</p>`);
        }

        if (inTable)      result.push(renderTable(tableHeaders, tableRows));
        if (inList)       result.push(`</${listType}>`);
        if (inBlockquote) result.push("</blockquote>");

        return result.join("\n");
    }

    function isListLine(t) {
        return t.startsWith("- ") || t.startsWith("* ") || /^\d+\.\s/.test(t);
    }

    /* 行内格式 */
    function inl(text) {
        let o = text || "";
        o = o.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
        o = o.replace(/__(.*?)__/g,     "<strong>$1</strong>");
        o = o.replace(/\*(.*?)\*/g,     "<em>$1</em>");
        o = o.replace(/_(.*?)_/g,       "<em>$1</em>");
        o = o.replace(/`(.*?)`/g,       "<code>$1</code>");
        return o;
    }

    /* 表格渲染 */
    function renderTable(headers, rows) {
        let h = "<table><thead><tr>";
        headers.forEach(c => { h += `<th>${inl(c)}</th>`; });
        h += "</tr></thead><tbody>";
        rows.forEach(r => {
            h += "<tr>";
            r.forEach(c => { h += `<td>${inl(c)}</td>`; });
            h += "</tr>";
        });
        h += "</tbody></table>";
        return h;
    }

    /* HTML 转义（用于动态文本插入） */
    function esc(str) {
        return (str || "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    /* ══════════════════════════════════
       启动
       ══════════════════════════════════ */
    initFilters();
    renderCatalog();
});

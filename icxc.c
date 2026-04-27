/* icxc - Orthodox daily readings, KJV, terminal-rendered.
 *
 * Single source: orthocal.info JSON API (KJV is public domain; orthocal also
 * carries the full Orthodox lectionary, including the deuterocanonical books).
 * One HTTP request per fresh day.
 *
 * Calendar: stored as one byte ('o' = Old / Julian, 'n' = New / Revised Julian)
 * at $XDG_CONFIG_HOME/icxc/icxc.conf (default ~/.config/icxc/icxc.conf). On
 * first run the user is prompted; the -cal flag flips the saved choice and
 * runs in the opposite calendar for that invocation.
 *
 * Cache: $XDG_CACHE_HOME/icxc-{old,new}.json, keyed by calendar so a -cal flip
 * cannot serve stale output. Valid until the next local calendar day; only the
 * implicit "today" invocation caches, an explicit date always refetches.
 *
 * Usage: icxc [YYYY-MM-DD] [-f | -c | -e | -g] [-cal]
 *   (no flag)     full: title, feasts, fast, commemorations, all readings
 *   -f            title + fast type
 *   -c            title + commemorations
 *   -e            title + epistle reading(s)
 *   -g            title + gospel reading(s)
 *   -cal          run in the opposite calendar and persist the flip
 *
 * Build: make */

#define _POSIX_C_SOURCE 200809L
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>
#include <sys/stat.h>
#include <sys/ioctl.h>
#include <curl/curl.h>
#include <json-c/json.h>

#define ORTHOCAL  "https://orthocal.info/api/%s/%d/%d/%d/"
#define WIDTHCAP  100      /* prose past this is unreadable, even on wide terms */

#define DIM      "\033[2m"
#define RST      "\033[0m"
#define TITLE    "\033[1;33m"
#define FEAST    "\033[36m"
#define HEAD     "\033[1;34m"
#define VNUM     "\033[2;33m"
#define FAST_OK  "\033[32m"
#define FAST_MID "\033[33m"
#define FAST_HOT "\033[31m"

/* json_object_array_length asserts on non-arrays; orthocal occasionally returns
 * null for optional array fields. Guard every array access through this. */
#define JARR(o) ((o) && json_object_is_type((o), json_type_array))

/* Output mode chosen on the CLI; gates which sections main() prints. The
 * yellow title is always shown regardless of mode. */
enum mode { MODE_FULL, MODE_FAST, MODE_COM, MODE_EPI, MODE_GOS };

/* Growable byte buffer; libcurl appends into it via write_cb, fread fills it
 * from the cache file. NUL-terminated so json_tokener_parse can consume it. */
typedef struct { char *p; size_t n; } buf;

static size_t write_cb(void *src, size_t s, size_t n, void *u) {
	size_t add = s * n;
	buf *b = u;
	char *q = realloc(b->p, b->n + add + 1);
	if (!q) return 0;
	b->p = q;
	memcpy(b->p + b->n, src, add);
	b->n += add;
	b->p[b->n] = 0;
	return add;
}

static int http_get(const char *url, buf *out) {
	out->p = NULL; out->n = 0;
	CURL *c = curl_easy_init();
	curl_easy_setopt(c, CURLOPT_URL,            url);
	curl_easy_setopt(c, CURLOPT_FOLLOWLOCATION, 1L);
	curl_easy_setopt(c, CURLOPT_USERAGENT,      "icxc/1.0");
	curl_easy_setopt(c, CURLOPT_TIMEOUT,        10L);
	curl_easy_setopt(c, CURLOPT_WRITEFUNCTION,  write_cb);
	curl_easy_setopt(c, CURLOPT_WRITEDATA,      out);
	int ok = curl_easy_perform(c) == CURLE_OK;
	curl_easy_cleanup(c);
	return ok ? 0 : -1;
}

/* --- terminal helpers --- */

static int term_cols(void) {
	struct winsize ws;
	return (ioctl(STDOUT_FILENO, TIOCGWINSZ, &ws) == 0 && ws.ws_col > 0)
	       ? ws.ws_col : 80;
}

/* Approximate display width by counting UTF-8 code points (every byte whose
 * top bits aren't 10xxxxxx). KJV English is ASCII + occasional smart quotes,
 * so this matches printed columns; would undercount CJK / combining marks. */
static int dwidth(const char *s, size_t n) {
	int w = 0;
	for (size_t i = 0; i < n; i++)
		if ((s[i] & 0xC0) != 0x80) w++;
	return w;
}

/* Greedy word-wrap. Cursor is already at start_col when called; subsequent
 * lines indent to indent. Splits on spaces, never mid-word. Trailing newline
 * is always emitted. */
static void wrap(const char *s, int width, int start_col, int indent) {
	int col = start_col, first = 1;
	for (const char *p = s; *p; ) {
		while (*p == ' ') p++;
		if (!*p) break;
		const char *w = p;
		while (*p && *p != ' ') p++;
		int ww = dwidth(w, p - w);
		int need = ww + (first ? 0 : 1);  /* +1 for the separating space */
		if (!first && col + need > width) {
			putchar('\n');
			for (int i = 0; i < indent; i++) putchar(' ');
			col = indent; first = 1; need = ww;
		}
		if (!first) putchar(' ');
		fwrite(w, 1, p - w, stdout);
		col += need; first = 0;
	}
	putchar('\n');
}

/* --- cache ---
 *
 * One file per calendar (old/new). Validity = mtime falls on today's local
 * calendar date, so the cache turns over at local midnight without any
 * explicit expiry tracking. Writes are atomic via tmp+rename so a crashed run
 * can never leave a truncated payload that future runs would read as today's. */

static void cache_path(char *out, size_t n, int cal) {
	const char *base = getenv("XDG_CACHE_HOME");
	const char *suf  = (cal == 'o') ? "old" : "new";
	if (base && *base) snprintf(out, n, "%s/icxc-%s.json", base, suf);
	else               snprintf(out, n, "%s/.cache/icxc-%s.json", getenv("HOME"), suf);
}

static int same_day(time_t a, time_t b) {
	struct tm ta = *localtime(&a), tb = *localtime(&b);
	return ta.tm_year == tb.tm_year && ta.tm_yday == tb.tm_yday;
}

static int cache_load(const char *path, buf *out) {
	struct stat st;
	if (stat(path, &st) != 0)             return -1;
	if (!same_day(st.st_mtime, time(NULL))) return -1;
	FILE *f = fopen(path, "rb");
	if (!f) return -1;
	out->p = malloc(st.st_size + 1);
	out->n = fread(out->p, 1, st.st_size, f);
	out->p[out->n] = 0;
	fclose(f);
	return 0;
}

static void cache_store(const char *path, const buf *b) {
	/* Best-effort parent mkdir; ignore EEXIST and any deeper failure since
	 * cache_store is purely an optimization; the next fopen will tell us. */
	char dir[512];
	snprintf(dir, sizeof dir, "%s", path);
	char *slash = strrchr(dir, '/');
	if (slash) { *slash = 0; mkdir(dir, 0700); }

	char tmp[600];
	snprintf(tmp, sizeof tmp, "%s.tmp", path);
	FILE *f = fopen(tmp, "wb");
	if (!f) return;
	if (fwrite(b->p, 1, b->n, f) == b->n) {
		fclose(f);
		rename(tmp, path);
	} else {
		fclose(f);
		unlink(tmp);
	}
}

/* --- calendar ---
 *
 * One byte at $XDG_CONFIG_HOME/icxc/icxc.conf: 'o' for Old (Julian), 'n' for
 * New (Revised Julian). Absent on first run -> prompt; -cal flips and rewrites. */

static void config_path(char *out, size_t n) {
	const char *base = getenv("XDG_CONFIG_HOME");
	if (base && *base) snprintf(out, n, "%s/icxc/icxc.conf", base);
	else               snprintf(out, n, "%s/.config/icxc/icxc.conf", getenv("HOME"));
}

/* `mkdir -p` for an absolute path. Mutates the buffer in place to NUL-terminate
 * each prefix in turn, then restores the slash. EEXIST and other errors are
 * ignored; callers treat persistence as best-effort. */
static void mkdir_p(char *path) {
	for (char *p = path + 1; *p; p++) {
		if (*p == '/') {
			*p = 0;
			mkdir(path, 0755);
			*p = '/';
		}
	}
}

static int calendar_load(const char *path) {
	FILE *f = fopen(path, "r");
	if (!f) return -1;
	int c = fgetc(f);
	fclose(f);
	return (c == 'o' || c == 'n') ? c : -1;
}

static void calendar_store(const char *path, int c) {
	char dir[512];
	snprintf(dir, sizeof dir, "%s", path);
	char *slash = strrchr(dir, '/');
	if (slash) {
		*slash = 0;
		mkdir_p(dir);   /* full chain (~/.config and ~/.config/icxc) */
		mkdir(dir, 0700);
	}
	FILE *f = fopen(path, "w");
	if (!f) return;
	fputc(c, f);
	fclose(f);
}

/* Yellow ASCII banner printed once above the first-run prompt: an Orthodox
 * cross paired with the "IC XC" christogram. */
static void print_banner(void) {
	fputs("\n" TITLE
	      "./_/\\/\\ .\xe2\x89\xa1\xe2\x89\xa1\xe2\x89\xa1\xe2\x89\xa1\xe2\x89\xa1.\xe2\x89\xa1\xe2\x89\xa1\xe2\x89\xa1\xe2\x89\xa1\xe2\x89\xa1.\xe2\x89\xa1...\xe2\x89\xa1.\xe2\x89\xa1\xe2\x89\xa1\xe2\x89\xa1\xe2\x89\xa1\xe2\x89\xa1.\n"
	      ".\\_\\  / ...\xe2\x95\x91...\xe2\x95\x91......\xe2\x95\x91.\xe2\x95\x91..\xe2\x95\x91.....\n"
	      "./_/  \\ .. \xe2\x95\x91...\xe2\x95\x91.......\xe2\x95\x91...\xe2\x95\x91.....\n"
	      ".\\_\\/\\ \\ ..\xe2\x95\x91...\xe2\x95\x91......\xe2\x95\x91.\xe2\x95\x91..\xe2\x95\x91.....\n"
	      "....\\_\\/.\xe2\x89\xa1\xe2\x89\xa1\xe2\x89\xa1\xe2\x89\xa1\xe2\x89\xa1.\xe2\x89\xa1\xe2\x89\xa1\xe2\x89\xa1\xe2\x89\xa1\xe2\x89\xa1.\xe2\x89\xa1...\xe2\x89\xa1.\xe2\x89\xa1\xe2\x89\xa1\xe2\x89\xa1\xe2\x89\xa1\xe2\x89\xa1.\n"
	      RST "\n", stderr);
}

/* First-run prompt. Reads one char from stdin, drains the rest of the line so
 * the user's Enter doesn't bleed into anything downstream. Refuses to proceed
 * non-interactively (cron, pipes) since there's no sensible default. */
static int calendar_prompt(void) {
	if (!isatty(STDIN_FILENO)) {
		fprintf(stderr, "icxc: no calendar configured; run interactively first\n");
		return -1;
	}
	print_banner();
	fprintf(stderr, "Do you follow the [n]ew or [o]ld calendar? ");
	fflush(stderr);
	int c = fgetc(stdin), d;
	while ((d = fgetc(stdin)) != '\n' && d != EOF) {}
	if (c == 'n' || c == 'N') return 'n';
	if (c == 'o' || c == 'O') return 'o';
	fprintf(stderr, "icxc: invalid choice (expected n or o)\n");
	return -1;
}

/* --- render --- */

/* Choose an ANSI color from orthocal's free-text fast description. "No Fast"
 * must come first, since it contains "Fast" as a substring. */
static const char *fast_color(const char *d) {
	if (!d || strstr(d, "No Fast")) return FAST_OK;
	if (strstr(d, "Strict"))        return FAST_HOT;
	if (strstr(d, "Fast"))          return FAST_MID;
	return FAST_OK;
}

/* Print one reading: blue header (e.g. "Mark 16.9-20"), then each verse with
 * its "chap:verse " prefix in dim yellow and KJV body wrapped to the terminal.
 * If `source_filter` is non-NULL, the reading is skipped unless its "source"
 * field contains that substring (e.g. "Epistle", "Gospel"). */
static void render_reading(json_object *r, int width, const char *source_filter) {
	if (source_filter) {
		json_object *src;
		if (!json_object_object_get_ex(r, "source", &src)) return;
		const char *s = json_object_get_string(src);
		if (!s || !strstr(s, source_filter)) return;
	}
	json_object *display, *passage;
	if (!json_object_object_get_ex(r, "display", &display)) return;
	const char *d = json_object_get_string(display);
	if (!d || !*d) return;
	printf("\n" HEAD "%s" RST "\n", d);

	if (!json_object_object_get_ex(r, "passage", &passage) || !JARR(passage)) return;
	int n = json_object_array_length(passage);
	for (int i = 0; i < n; i++) {
		json_object *p = json_object_array_get_idx(passage, i);
		json_object *jc, *jv, *jcn;
		if (!json_object_object_get_ex(p, "chapter", &jc) ||
		    !json_object_object_get_ex(p, "verse",   &jv) ||
		    !json_object_object_get_ex(p, "content", &jcn))
			continue;
		const char *text = json_object_get_string(jcn);
		if (!text) continue;

		char prefix[16];
		int plen = snprintf(prefix, sizeof prefix, "%d:%-2d ",
		                    json_object_get_int(jc), json_object_get_int(jv));
		printf(VNUM "%s" RST, prefix);
		wrap(text, width, plen, plen);
	}
}

/* --- main ---
 *
 * 1. Parse argv: optional YYYY-MM-DD, optional mode flag, optional -cal.
 * 2. Resolve the calendar: load from config, prompt on first run, persist a
 *    flip if -cal was given. The chosen calendar selects the orthocal API
 *    path segment ("julian" or "gregorian") and the cache file suffix.
 * 3. Implicit "today" + cache hit -> skip the network. Explicit date bypasses
 *    cache entirely so it can never poison today's stored payload.
 * 4. Render the title, then whichever sections the mode permits.
 */
int main(int argc, char **argv) {
	enum mode mode = MODE_FULL;
	const char *date_arg = NULL;
	int flip = 0;

	for (int i = 1; i < argc; i++) {
		const char *a = argv[i];
		if      (!strcmp(a, "-f"))   mode = MODE_FAST;
		else if (!strcmp(a, "-c"))   mode = MODE_COM;
		else if (!strcmp(a, "-e"))   mode = MODE_EPI;
		else if (!strcmp(a, "-g"))   mode = MODE_GOS;
		else if (!strcmp(a, "-cal")) flip = 1;
		else if (!date_arg && a[0] != '-') date_arg = a;
		else {
			fprintf(stderr, "usage: icxc [YYYY-MM-DD] [-f|-c|-e|-g] [-cal]\n");
			return 1;
		}
	}

	/* Resolve calendar: load saved, or prompt on first run. -cal then flips
	 * the result and rewrites the config so the new value persists. */
	char cfg[512];
	config_path(cfg, sizeof cfg);
	int cal = calendar_load(cfg);
	if (cal < 0) {
		cal = calendar_prompt();
		if (cal < 0) return 1;
		calendar_store(cfg, cal);
	}
	if (flip) {
		cal = (cal == 'o') ? 'n' : 'o';
		calendar_store(cfg, cal);
	}
	const char *cal_seg = (cal == 'o') ? "julian" : "gregorian";

	int year, month, day;
	if (date_arg) {
		if (sscanf(date_arg, "%d-%d-%d", &year, &month, &day) != 3 ||
		    year < 1 || month < 1 || month > 12 || day < 1 || day > 31) {
			fprintf(stderr, "icxc: invalid date '%s' (expected YYYY-MM-DD)\n", date_arg);
			return 1;
		}
	} else {
		time_t now = time(NULL);
		struct tm *tm = localtime(&now);
		year  = tm->tm_year + 1900;
		month = tm->tm_mon + 1;
		day   = tm->tm_mday;
	}

	char path[512];
	cache_path(path, sizeof path, cal);

	buf b;
	int loaded = !date_arg && cache_load(path, &b) == 0;
	if (!loaded) {
		curl_global_init(CURL_GLOBAL_DEFAULT);
		char url[160];
		snprintf(url, sizeof url, ORTHOCAL, cal_seg, year, month, day);
		if (http_get(url, &b) != 0) {
			fprintf(stderr, "icxc: orthocal fetch failed\n");
			return 1;
		}
		if (!date_arg) cache_store(path, &b);
		curl_global_cleanup();
	}

	json_object *root = json_tokener_parse(b.p);
	free(b.p);
	if (!root) { fprintf(stderr, "icxc: bad JSON\n"); return 1; }

	int width = term_cols();
	if (width < 40)        width = 40;
	if (width > WIDTHCAP)  width = WIDTHCAP;

	/* Title is always printed. */
	json_object *jt;
	if (json_object_object_get_ex(root, "summary_title", &jt)) {
		const char *s = json_object_get_string(jt);
		if (s && *s) printf("\n" TITLE "%s" RST "\n", s);
	}

	/* Feasts: full mode only. */
	if (mode == MODE_FULL &&
	    json_object_object_get_ex(root, "feasts", &jt) && JARR(jt)) {
		int n = json_object_array_length(jt);
		for (int i = 0; i < n; i++) {
			const char *f = json_object_get_string(json_object_array_get_idx(jt, i));
			if (f && *f) printf(FEAST "  %s" RST "\n", f);
		}
	}

	/* Fast: full mode and -f. */
	if (mode == MODE_FULL || mode == MODE_FAST) {
		const char *fast = NULL, *exc = NULL;
		if (json_object_object_get_ex(root, "fast_level_desc", &jt))
			fast = json_object_get_string(jt);
		if (json_object_object_get_ex(root, "fast_exception_desc", &jt))
			exc = json_object_get_string(jt);
		if (fast && *fast) {
			printf("  %sFast: %s", fast_color(fast), fast);
			if (exc && *exc) printf(" (%s)", exc);
			printf(RST "\n");
		}
	}

	/* Commemorations: full mode and -c. */
	if ((mode == MODE_FULL || mode == MODE_COM) &&
	    json_object_object_get_ex(root, "saints", &jt) && JARR(jt)) {
		int n = json_object_array_length(jt);
		if (n > 0) printf("\n" DIM "Commemorating:" RST "\n");
		for (int i = 0; i < n; i++) {
			const char *s = json_object_get_string(json_object_array_get_idx(jt, i));
			if (!s || !*s) continue;
			printf("  ");
			wrap(s, width, 2, 2);
		}
	}

	/* Readings: full mode prints all; -e/-g restricts by source substring. */
	const char *src_filter = (mode == MODE_EPI) ? "Epistle"
	                       : (mode == MODE_GOS) ? "Gospel"
	                       : NULL;
	int show_readings = (mode == MODE_FULL || mode == MODE_EPI || mode == MODE_GOS);
	json_object *readings = NULL;
	if (show_readings &&
	    json_object_object_get_ex(root, "readings", &readings) && JARR(readings)) {
		int n = json_object_array_length(readings);
		for (int i = 0; i < n; i++)
			render_reading(json_object_array_get_idx(readings, i), width, src_filter);
	}
	putchar('\n');

	json_object_put(root);
	return 0;
}

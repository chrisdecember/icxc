# icxc

```
./_/\/\ .≡≡≡≡≡.≡≡≡≡≡.≡...≡.≡≡≡≡≡.
.\_\  / ...║...║......║.║..║.....
./_/  \ .. ║...║.......║...║.....
.\_\/\ \ ..║...║......║.║..║.....
....\_\/.≡≡≡≡≡.≡≡≡≡≡.≡...≡.≡≡≡≡≡.
```

Orthodox daily readings, KJV, rendered for the terminal.

## Source

Lectionary schedule, fast type, feasts, saints, and verse text are all pulled from the [orthocal.info](https://orthocal.info) JSON API. Orthocal carries the full Orthodox lectionary, including the deuterocanonical books, and ships verses as KJV, which is public domain. icxc would not exist without it.

## Dependencies

- libcurl
- json-c
- a C11 compiler

## Build

    make
    make install            # installs to ~/.local/bin/icxc

`PREFIX` defaults to `$HOME/.local`. Override with `make install PREFIX=/usr/local`.

## First run

On first invocation icxc prints the banner above and asks whether you follow the **[n]ew** or **[o]ld** calendar. Your answer is saved to `$XDG_CONFIG_HOME/icxc/icxc.conf` (default `~/.config/icxc/icxc.conf`); every subsequent run uses that setting silently.

The `-cal` flag runs once in the *opposite* calendar and persists the flip, so your saved setting becomes whatever you just rendered against. Use it to switch styles permanently or to peek at the other side without editing files.

## Usage

    icxc                    # full output for today
    icxc YYYY-MM-DD         # readings for an arbitrary date
    icxc -f                 # title + fast type
    icxc -c                 # title + commemorations
    icxc -e                 # title + epistle reading(s)
    icxc -g                 # title + gospel reading(s)
    icxc -cal               # flip calendar and run

Flags compose, e.g. `icxc 2026-04-12 -g` or `icxc -cal -e`.

## Cache

The day's JSON payload is cached at `$XDG_CACHE_HOME/icxc-{old,new}.json` (default `~/.cache/`) and turns over at local midnight. The cache is keyed by calendar so a `-cal` flip can never serve stale output. Explicit-date invocations always fetch and never touch the cache.

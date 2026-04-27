CC      ?= gcc
CFLAGS  ?= -O2 -Wall -Wextra -std=c11
LDLIBS  := $(shell pkg-config --libs libcurl json-c)
CFLAGS  += $(shell pkg-config --cflags libcurl json-c)
PREFIX  ?= $(HOME)/.local

icxc: icxc.c
	$(CC) $(CFLAGS) -o $@ $< $(LDLIBS)

install: icxc
	install -Dm755 icxc $(PREFIX)/bin/icxc

clean:
	rm -f icxc

.PHONY: install clean

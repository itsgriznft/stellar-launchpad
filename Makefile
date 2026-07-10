# The factory embeds the campaign's contract spec via `contractimport!`, so the
# campaign wasm has to exist before the factory can be compiled or tested.
# Every target below depends on that ordering.
#
# `stellar contract build` produces a smaller, metadata-rich wasm and is what
# deployments use. Plain cargo emits an equivalent module — bigger, since it
# skips the optimizer — which is enough to compile and test the factory against.
# CI therefore needs no extra tooling.

CAMPAIGN_WASM := target/wasm32v1-none/release/campaign.wasm
FACTORY_WASM  := target/wasm32v1-none/release/factory.wasm

STELLAR := $(shell command -v stellar 2>/dev/null)
ifdef STELLAR
  BUILD := stellar contract build --package
else
  BUILD := cargo build --locked --target wasm32v1-none --release --package
endif

.PHONY: all build campaign factory test fmt clean

all: build

build: factory

campaign:
	$(BUILD) campaign

factory: campaign
	$(BUILD) factory

test: campaign
	cargo test --locked

fmt:
	cargo fmt --all

clean:
	cargo clean

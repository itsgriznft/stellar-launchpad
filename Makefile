# The factory embeds the campaign's contract spec via `contractimport!`, so the
# campaign wasm has to exist before the factory can be compiled or tested.
# Every target below depends on that ordering.

CAMPAIGN_WASM := target/wasm32v1-none/release/campaign.wasm
FACTORY_WASM  := target/wasm32v1-none/release/factory.wasm

.PHONY: all build campaign factory test fmt clean

all: build

build: $(FACTORY_WASM)

campaign $(CAMPAIGN_WASM):
	stellar contract build --package campaign

factory $(FACTORY_WASM): $(CAMPAIGN_WASM)
	stellar contract build --package factory

test: $(CAMPAIGN_WASM)
	cargo test --locked

fmt:
	cargo fmt --all

clean:
	cargo clean

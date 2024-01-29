package assetlist

import "encoding/json"

type Root struct {
	Schema    string  `json:"$schema,omitempty"`
	Assets    []Asset `json:"assets"`
	ChainName string  `json:"chain_name"`
}

type Asset struct {
	Address     string      `json:"address,omitempty"`
	Base        string      `json:"base"`
	CoingeckoId string      `json:"coingecko_id,omitempty"`
	DenomUnits  []DenomUnit `json:"denom_units"`
	Description string      `json:"description,omitempty"`
	Display     string      `json:"display"`
	Ibc         *struct {
		DstChannel    string `json:"dst_channel"`
		SourceChannel string `json:"source_channel"`
		SourceDenom   string `json:"source_denom"`
	} `json:"ibc,omitempty"`
	Keywords []string `json:"keywords,omitempty"`
	LogoURIs *struct {
		Png string `json:"png,omitempty"`
		Svg string `json:"svg,omitempty"`
	} `json:"logo_URIs,omitempty"`
	Name      string            `json:"name"`
	Symbol    string            `json:"symbol"`
	Traces    []json.RawMessage `json:"traces,omitempty"`
	TypeAsset string            `json:"type_asset,omitempty"`
}

type AssetPointer struct {
	BaseDenom string `json:"base_denom"`
	Platform  string `json:"platform"`
}

type DenomUnit struct {
	Aliases  []string `json:"aliases,omitempty"`
	Denom    string   `json:"denom"`
	Exponent int64    `json:"exponent"`
}

type IbcCw20Transition struct {
	Chain struct {
		ChannelId string `json:"channel_id"`
		Path      string `json:"path,omitempty"`
		Port      string `json:"port"`
	} `json:"chain"`
	Counterparty struct {
		BaseDenom string `json:"base_denom"`
		ChainName string `json:"chain_name"`
		ChannelId string `json:"channel_id"`
		Port      string `json:"port"`
	} `json:"counterparty"`
	Type string `json:"type"`
}

type IbcTransition struct {
	Chain struct {
		ChannelId string `json:"channel_id"`
		Path      string `json:"path,omitempty"`
	} `json:"chain"`
	Counterparty struct {
		BaseDenom string `json:"base_denom"`
		ChainName string `json:"chain_name"`
		ChannelId string `json:"channel_id"`
	} `json:"counterparty"`
	Type string `json:"type"`
}

type NonIbcTransition struct {
	Chain *struct {
		Contract string `json:"contract"`
	} `json:"chain,omitempty"`
	Counterparty struct {
		BaseDenom string `json:"base_denom"`
		ChainName string `json:"chain_name"`
		Contract  string `json:"contract,omitempty"`
	} `json:"counterparty"`
	Provider string `json:"provider"`
	Type     string `json:"type"`
}

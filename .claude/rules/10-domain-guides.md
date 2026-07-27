# Domain Guides — HVAC / Manufacturing

## Business Context
Liberty Connect is an ERP frontend for HVAC and manufacturing businesses. Understanding industry conventions ensures correct data handling.

## Manufacturer Names
- Always preserve exact casing from source data
- Never normalize or title-case manufacturer names (e.g., `Johnson Controls` stays as-is from Directus)

## Model Part Numbers (MPN)
- Always uppercase in outputs and displays
- MPNs are critical identifiers — never truncate or abbreviate

## Product Descriptions
- Focus on technical specifications (capacity, voltage, dimensions, efficiency ratings)
- Use industry-standard units and formats

## Filename Generation
- Pattern: `manufacturer_MPN_position.format`
- Example: `carrier_58STA090_front.jpg`
- Use underscores as separators, lowercase except MPN

## Industry Abbreviations
Use standard HVAC abbreviations where appropriate:
- CFH — Cubic Feet per Hour
- BTU — British Thermal Unit
- SPDT — Single Pole Double Throw
- AFUE — Annual Fuel Utilization Efficiency
- SEER — Seasonal Energy Efficiency Ratio
- MERV — Minimum Efficiency Reporting Value
- AHU — Air Handling Unit
- RTU — Rooftop Unit
- VAV — Variable Air Volume

from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional, Dict, Any

@dataclass
class TradeRecord:
    date: datetime
    account_name: str
    symbol: str
    side: str  # 'BUY' or 'SELL'
    quantity: float
    price: float
    fees: float
    original_currency: str
    source_file: str
    raw_data: Dict[str, Any] = field(default_factory=dict)

    def to_row(self):
        """Returns a list of values for Google Sheets upload."""
        return [
            self.date.strftime('%Y-%m-%d %H:%M:%S'),
            self.account_name,
            self.symbol,
            self.side,
            self.quantity,
            self.price,
            self.fees,
            self.original_currency,
            self.source_file
        ]

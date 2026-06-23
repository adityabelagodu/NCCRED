"""Turn customer call recordings into quotes in the RACHNA ENTERPRISES sheet.

Pipeline: audio -> transcript (Google Speech-to-Text) -> structured line items
(Claude) -> priced quote -> preview -> (on confirm) append to the Google Sheet.
"""

__version__ = "0.1.0"

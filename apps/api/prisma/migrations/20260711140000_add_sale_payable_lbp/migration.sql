-- Persists the cash-rounding disclosure (rounded LBP payable, nearest 5,000
-- banknote) on the Sale record itself. Previously computed correctly at
-- checkout but never saved, so reprints and CSV exports always showed it
-- blank once the sale left the live checkout screen.

-- AlterTable
ALTER TABLE "Sale" ADD COLUMN "payableLbp" DECIMAL(18,4);

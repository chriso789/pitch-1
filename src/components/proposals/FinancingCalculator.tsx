import React, { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Calculator, DollarSign, Percent, Calendar, CheckCircle, Star } from 'lucide-react';

interface FinancingOption {
  id: string;
  name: string;
  apr: number;
  terms: number[];
  minAmount: number;
  maxAmount: number;
  fees?: number;
  promoRate?: number;
  promoMonths?: number;
}

const DEFAULT_FINANCING_OPTIONS: FinancingOption[] = [
  { id: 'greensky', name: 'GreenSky', apr: 9.99, terms: [12, 24, 36, 48, 60, 84, 120], minAmount: 1000, maxAmount: 100000 },
  { id: 'synchrony', name: 'Synchrony', apr: 12.99, terms: [12, 24, 36, 48, 60], minAmount: 500, maxAmount: 55000, promoRate: 0, promoMonths: 12 },
  { id: 'mosaic', name: 'Mosaic Solar', apr: 4.99, terms: [60, 120, 144, 180, 240], minAmount: 5000, maxAmount: 150000 },
  { id: 'goodleap', name: 'GoodLeap', apr: 7.99, terms: [60, 84, 120, 144], minAmount: 3000, maxAmount: 100000 },
  { id: 'sunlight', name: 'Sunlight Financial', apr: 6.99, terms: [60, 120, 180, 240], minAmount: 5000, maxAmount: 100000 },
];

interface FinancingCalculatorProps {
  projectTotal: number;
  onSelectOption?: (option: { lender: string; term: number; monthlyPayment: number; apr: number }) => void;
}

export const FinancingCalculator: React.FC<FinancingCalculatorProps> = ({
  projectTotal,
  onSelectOption
}) => {
  const [amount, setAmount] = useState(projectTotal);
  const [downPayment, setDownPayment] = useState(0);
  const [selectedTerm, setSelectedTerm] = useState(60);
  const [selectedLender, setSelectedLender] = useState<string>('');

  const financeAmount = amount - downPayment;

  const calculatePayment = (principal: number, annualRate: number, months: number) => {
    if (annualRate === 0) return principal / months;
    const monthlyRate = annualRate / 100 / 12;
    return (principal * monthlyRate * Math.pow(1 + monthlyRate, months)) / (Math.pow(1 + monthlyRate, months) - 1);
  };

  const paymentOptions = useMemo(() => {
    return DEFAULT_FINANCING_OPTIONS.map(option => {
      const payments = option.terms.map(term => ({
        term,
        monthlyPayment: calculatePayment(financeAmount, option.apr, term),
        totalPayment: calculatePayment(financeAmount, option.apr, term) * term,
        totalInterest: (calculatePayment(financeAmount, option.apr, term) * term) - financeAmount
      }));

      return {
        ...option,
        payments,
        bestTerm: payments.find(p => p.term === selectedTerm) || payments[0]
      };
    }).filter(opt => financeAmount >= opt.minAmount && financeAmount <= opt.maxAmount);
  }, [financeAmount, selectedTerm]);

  const handleSelectOption = (option: FinancingOption, term: number) => {
    const payment = calculatePayment(financeAmount, option.apr, term);
    setSelectedLender(option.id);
    setSelectedTerm(term);
    onSelectOption?.({
      lender: option.name,
      term,
      monthlyPayment: payment,
      apr: option.apr
    });
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Calculator className="h-5 w-5" />
          Financing Calculator
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Input Section */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <Label htmlFor="amount">Project Total</Label>
            <div className="relative mt-1">
              <DollarSign className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                id="amount"
                type="number"
                value={amount}
                onChange={(e) => setAmount(Number(e.target.value))}
                className="pl-9"
              />
            </div>
          </div>
          <div>
            <Label htmlFor="downPayment">Down Payment</Label>
            <div className="relative mt-1">
              <DollarSign className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                id="downPayment"
                type="number"
                value={downPayment}
                onChange={(e) => setDownPayment(Number(e.target.value))}
                className="pl-9"
              />
            </div>
          </div>
          <div>
            <Label>Preferred Term</Label>
            <Select value={selectedTerm.toString()} onValueChange={(v) => setSelectedTerm(Number(v))}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="12">12 months</SelectItem>
                <SelectItem value="24">24 months</SelectItem>
                <SelectItem value="36">36 months</SelectItem>
                <SelectItem value="48">48 months</SelectItem>
                <SelectItem value="60">60 months (5 years)</SelectItem>
                <SelectItem value="84">84 months (7 years)</SelectItem>
                <SelectItem value="120">120 months (10 years)</SelectItem>
                <SelectItem value="180">180 months (15 years)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="p-4 bg-muted rounded-lg">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Amount to Finance</span>
            <span className="text-2xl font-bold">{formatCurrency(financeAmount)}</span>
          </div>
        </div>

        {/* Comparison Table */}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Lender</TableHead>
              <TableHead className="text-center">APR</TableHead>
              <TableHead className="text-center">Term</TableHead>
              <TableHead className="text-right">Monthly Payment</TableHead>
              <TableHead className="text-right">Total Interest</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paymentOptions.map((option) => {
              const isSelected = selectedLender === option.id;
              const payment = option.bestTerm;

              return (
                <TableRow key={option.id} className={isSelected ? 'bg-primary/5' : ''}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{option.name}</span>
                      {option.promoRate !== undefined && (
                        <Badge variant="secondary" className="text-xs">
                          0% for {option.promoMonths}mo
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-center">
                    <div className="flex items-center justify-center gap-1">
                      <Percent className="h-3 w-3" />
                      {option.apr}%
                    </div>
                  </TableCell>
                  <TableCell className="text-center">
                    <Select 
                      value={payment.term.toString()} 
                      onValueChange={(v) => handleSelectOption(option, Number(v))}
                    >
                      <SelectTrigger className="w-28">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {option.terms.map(term => (
                          <SelectItem key={term} value={term.toString()}>
                            {term} months
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell className="text-right font-bold text-lg">
                    {formatCurrency(payment.monthlyPayment)}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {formatCurrency(payment.totalInterest)}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant={isSelected ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => handleSelectOption(option, payment.term)}
                    >
                      {isSelected ? (
                        <>
                          <CheckCircle className="h-4 w-4 mr-1" />
                          Selected
                        </>
                      ) : (
                        'Select'
                      )}
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>

        {/* Best Option Highlight */}
        {paymentOptions.length > 0 && (
          <Card className="bg-primary/5 border-primary/20">
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <Star className="h-5 w-5 text-primary mt-0.5" />
                <div>
                  <p className="font-medium">Best Value Option</p>
                  <p className="text-sm text-muted-foreground">
                    {paymentOptions.sort((a, b) => 
                      (a.bestTerm.totalInterest) - (b.bestTerm.totalInterest)
                    )[0]?.name} with {selectedTerm} month term saves you the most in interest.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Disclosure */}
        <p className="text-xs text-muted-foreground">
          * APR and terms subject to credit approval. Rates shown are estimates and may vary based on creditworthiness. 
          Actual rates and terms will be provided upon application. This calculator is for estimation purposes only.
        </p>
      </CardContent>
    </Card>
  );
};

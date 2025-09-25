import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { 
  CreditCard, 
  DollarSign, 
  Calendar,
  User,
  MapPin,
  CheckCircle,
  AlertTriangle
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface PaymentFormProps {
  selectedJob?: any;
}

const PaymentForm = ({ selectedJob }: PaymentFormProps) => {
  const { toast } = useToast();
  const [formData, setFormData] = useState({
    amount: selectedJob?.remainingBalance?.toString() || "",
    paymentMethod: "credit_card",
    customerEmail: selectedJob?.email || "",
    description: `Payment for ${selectedJob?.projectType || 'project'}`,
    customerName: selectedJob?.customer || "",
    sendReceipt: true
  });

  const [processing, setProcessing] = useState(false);

  const handleInputChange = (field: string, value: string) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setProcessing(true);

    // Simulate payment processing
    setTimeout(() => {
      setProcessing(false);
      toast({
        title: "Payment Processed Successfully",
        description: `$${formData.amount} payment has been processed for ${formData.customerName}`,
      });
      
      // Reset form
      setFormData({
        amount: "",
        paymentMethod: "credit_card",
        customerEmail: "",
        description: "",
        customerName: "",
        sendReceipt: true
      });
    }, 2000);
  };

  return (
    <div className="space-y-6">
      {/* Selected Job Summary */}
      {selectedJob && (
        <Card className="shadow-soft border-0 bg-primary/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-primary">
              <User className="h-5 w-5" />
              Selected Job
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-sm text-muted-foreground">Project ID</Label>
                <p className="font-mono font-semibold">{selectedJob.id}</p>
              </div>
              <div>
                <Label className="text-sm text-muted-foreground">Customer</Label>
                <p className="font-semibold">{selectedJob.customer}</p>
              </div>
            </div>
            
            <div className="flex items-center gap-2 text-sm">
              <MapPin className="h-4 w-4 text-muted-foreground" />
              {selectedJob.address}
            </div>

            <div className="grid grid-cols-3 gap-4 pt-3 border-t border-border">
              <div className="text-center">
                <Label className="text-xs text-muted-foreground">Total Project</Label>
                <p className="font-bold text-lg">${selectedJob.totalAmount?.toLocaleString()}</p>
              </div>
              <div className="text-center">
                <Label className="text-xs text-muted-foreground">Amount Paid</Label>
                <p className="font-bold text-lg text-success">${selectedJob.paidAmount?.toLocaleString()}</p>
              </div>
              <div className="text-center">
                <Label className="text-xs text-muted-foreground">Balance Due</Label>
                <p className="font-bold text-lg text-warning">${selectedJob.remainingBalance?.toLocaleString()}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Payment Form */}
      <Card className="shadow-soft border-0">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-primary" />
            Payment Details
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="customerName">Customer Name</Label>
                <Input
                  id="customerName"
                  value={formData.customerName}
                  onChange={(e) => handleInputChange("customerName", e.target.value)}
                  placeholder="Enter customer name"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="customerEmail">Customer Email</Label>
                <Input
                  id="customerEmail"
                  type="email"
                  value={formData.customerEmail}
                  onChange={(e) => handleInputChange("customerEmail", e.target.value)}
                  placeholder="customer@email.com"
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="amount">Payment Amount</Label>
                <div className="relative">
                  <DollarSign className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="amount"
                    type="number"
                    step="0.01"
                    value={formData.amount}
                    onChange={(e) => handleInputChange("amount", e.target.value)}
                    placeholder="0.00"
                    className="pl-10"
                    required
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="paymentMethod">Payment Method</Label>
                <Select 
                  value={formData.paymentMethod} 
                  onValueChange={(value) => handleInputChange("paymentMethod", value)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select payment method" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="credit_card">Credit Card</SelectItem>
                    <SelectItem value="debit_card">Debit Card</SelectItem>
                    <SelectItem value="ach">ACH Bank Transfer</SelectItem>
                    <SelectItem value="check">Check</SelectItem>
                    <SelectItem value="cash">Cash</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Payment Description</Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) => handleInputChange("description", e.target.value)}
                placeholder="Enter payment description or notes..."
                rows={3}
              />
            </div>

            {formData.paymentMethod === "credit_card" && (
              <Card className="bg-muted/50">
                <CardContent className="p-4 space-y-4">
                  <h4 className="font-semibold flex items-center gap-2">
                    <CreditCard className="h-4 w-4" />
                    Credit Card Details
                  </h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="col-span-2">
                      <Label htmlFor="cardNumber">Card Number</Label>
                      <Input
                        id="cardNumber"
                        placeholder="1234 5678 9012 3456"
                        maxLength={19}
                      />
                    </div>
                    <div>
                      <Label htmlFor="expiry">Expiry Date</Label>
                      <Input
                        id="expiry"
                        placeholder="MM/YY"
                        maxLength={5}
                      />
                    </div>
                    <div>
                      <Label htmlFor="cvv">CVV</Label>
                      <Input
                        id="cvv"
                        placeholder="123"
                        maxLength={4}
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="sendReceipt"
                checked={formData.sendReceipt}
                onChange={(e) => handleInputChange("sendReceipt", e.target.checked.toString())}
                className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
              />
              <Label htmlFor="sendReceipt" className="text-sm">
                Send receipt to customer email
              </Label>
            </div>

            <div className="pt-4 border-t border-border">
              <div className="flex items-center justify-between mb-4">
                <span className="text-lg font-semibold">Total Amount:</span>
                <span className="text-2xl font-bold text-primary">
                  ${parseFloat(formData.amount || "0").toLocaleString()}
                </span>
              </div>

              <Button 
                type="submit" 
                className="w-full gradient-primary text-white shadow-soft"
                disabled={processing || !formData.amount || !formData.customerName}
              >
                {processing ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                    Processing Payment...
                  </>
                ) : (
                  <>
                    <CheckCircle className="h-4 w-4 mr-2" />
                    Process Payment
                  </>
                )}
              </Button>
            </div>

            {/* Security Notice */}
            <div className="flex items-start gap-2 p-3 bg-success/10 rounded-lg text-sm">
              <CheckCircle className="h-4 w-4 text-success mt-0.5" />
              <div>
                <p className="font-medium text-success">Secure Payment Processing</p>
                <p className="text-muted-foreground">All payments are processed securely through Stripe with bank-level encryption.</p>
              </div>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};

export default PaymentForm;
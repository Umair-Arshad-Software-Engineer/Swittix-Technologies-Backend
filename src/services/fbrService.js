const axios = require('axios');

const FBR_SANDBOX_URL = 'https://esp.fbr.gov.pk:8244/DigitalInvoicing/v1/PostInvoiceData_v1';
const FBR_PRODUCTION_URL = 'https://gw.fbr.gov.pk/pdi/v1/api/DigitalInvoicing/PostInvoiceData_v1';

// Yeh values FBR/PRAL registration ke baad milengi (.env mein rakho)
const FBR_TOKEN = process.env.FBR_SECURITY_TOKEN; // e.g. sandbox: 07eabd29-fb34-3a2a-ab73-1ff4eb282aef
const FBR_ENV = process.env.FBR_ENV || 'sandbox'; // 'sandbox' | 'production'
const FBR_BPOS_ID = process.env.FBR_BPOS_ID; // aapka registered POS ID
const SELLER_NTN = process.env.SELLER_NTN;

/**
 * Sale record + cart items ko FBR ke required JSON shape mein convert karke
 * submit karta hai. Returns { success, invoiceNumber, raw }.
 */
async function submitInvoiceToFBR({ sale, items, customerName, customerNTN }) {
    const url = FBR_ENV === 'production' ? FBR_PRODUCTION_URL : FBR_SANDBOX_URL;

    const invoiceItemDetails = items.map((item) => ({
        hsCode: item.hsCode,                 // Product model mein add karna hoga
        productCode: item.itemCode,
        productDescription: item.productName,
        rate: item.taxPercentage || 0,
        uoM: item.uomCode,                    // e.g. Product model field
        quantity: item.quantity,
        valueSalesExcludingST: item.unitPrice * item.quantity,
        salesTaxApplicable: item.taxAmount || 0,
        retailPrice: item.unitPrice,
        totalValues: (item.unitPrice * item.quantity) + (item.taxAmount || 0),
    }));

    const totalSalesTax = invoiceItemDetails.reduce((s, i) => s + i.salesTaxApplicable, 0);
    const totalRetail = invoiceItemDetails.reduce((s, i) => s + i.totalValues, 0);

    const payload = {
        bposId: FBR_BPOS_ID,
        invoiceType: '2', // 2 = Sale
        invoiceDate: new Date().toISOString().slice(0, 10),
        ntN_CNIC: customerNTN || SELLER_NTN, // buyer NTN/CNIC agar available ho, warna seller ka
        buyerSellerName: customerName || 'Walk-in Customer',
        destinationAddress: 'N/A',
        saleType: 1, // FBR ki Sale Type list se sahi code lagana hoga
        totalSalesTaxApplicable: totalSalesTax,
        totalRetailPrice: totalRetail,
        invoiceItemDetails,
    };

    try {
        const response = await axios.post(url, payload, {
            headers: {
                Authorization: `Bearer ${FBR_TOKEN}`,
                'Content-Type': 'application/json',
            },
            timeout: 15000,
        });

        const data = response.data;
        if (data.statusCode === 200 && data.result) {
            return { success: true, invoiceNumber: data.result, raw: data };
        }
        return { success: false, error: data.errorMessage || 'Unknown FBR error', raw: data };
    } catch (err) {
        console.error('FBR submission error:', err.response?.data || err.message);
        return { success: false, error: err.message };
    }
}

module.exports = { submitInvoiceToFBR };
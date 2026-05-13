export function buildReferralSmsMessage(companyName: string, referralUrl: string, _rewardUrl: string): string {
  return `Thanks for trusting ${companyName}! Share this link with friends and we'll thank you with a reward: ${referralUrl}`;
}

export function buildReferralEmailSubject(companyName: string): string {
  return `A quick thank-you from ${companyName} — refer a friend, get rewarded`;
}

export function buildReferralEmailBody(companyName: string, referralUrl: string, rewardUrl: string): string {
  return `Hi there,

Thank you for working with ${companyName}. We grow through happy customers like you.

If you know someone who could use a great roof or repair, share your personal referral link:
${referralUrl}

Once they become a customer, you'll get a reward. You can pick how you'd like to receive it here:
${rewardUrl}

Thanks again!
— The ${companyName} team`;
}

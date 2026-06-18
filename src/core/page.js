/**
 * 逐页调用 header/footer render 回调
 */
export function renderHeaderFooter(doc, { totalPages, ctx, header, footer }) {
  const { margin, pageWidth, pageHeight } = ctx;
  const info = { totalPages, pageWidth, pageHeight, margin };

  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);

    if (header && typeof header.render === 'function') {
      header.render(doc, { ...info, pageNumber: p });
    }

    if (footer && typeof footer.render === 'function') {
      footer.render(doc, { ...info, pageNumber: p });
    }
  }
}
